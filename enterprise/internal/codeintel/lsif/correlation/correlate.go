package correlation

import (
	"context"
	"fmt"
	"io"
	"path/filepath"
	"strings"

	"github.com/inconshreveable/log15"
	protocol "github.com/sourcegraph/lsif-protocol"
	"github.com/sourcegraph/sourcegraph/enterprise/internal/codeintel/lsif/datastructures"
	"github.com/sourcegraph/sourcegraph/enterprise/internal/codeintel/lsif/existence"
	"github.com/sourcegraph/sourcegraph/enterprise/internal/codeintel/lsif/lsif"
)

// Correlate reads LSIF data from the given reader and returns a correlation state object with
// the same data canonicalized and pruned for storage.
func Correlate(ctx context.Context, r io.Reader, dumpID int, root string, getChildren existence.GetChildrenFunc) (*GroupedBundleDataChans, error) {
	// Read raw upload stream and return a correlation state
	state, err := correlateFromReader(ctx, r, root)
	if err != nil {
		return nil, err
	}

	// Remove duplicate elements, collapse linked elements
	canonicalize(state)

	// Remove elements we don't need to store
	if err := prune(ctx, state, root, getChildren); err != nil {
		return nil, err
	}

	// Convert data to the format we send to the writer
	groupedBundleData, err := groupBundleData(ctx, state, dumpID)
	if err != nil {
		return nil, err
	}

	return groupedBundleData, nil
}

// correlateFromReader reads the given upload stream and returns a correlation state object.
// The data in the correlation state is neither canonicalized nor pruned.
func correlateFromReader(ctx context.Context, r io.Reader, root string) (*State, error) {
	ctx, cancel := context.WithCancel(ctx)
	ch := lsif.Read(ctx, r)
	defer func() {
		// stop producer from reading more input on correlation error
		cancel()

		for range ch {
			// drain whatever is in the channel to help out GC
		}
	}()

	wrappedState := newWrappedState(root)

	i := 0
	for pair := range ch {
		i++

		if pair.Err != nil {
			return nil, fmt.Errorf("dump malformed on element %d: %s", i, pair.Err)
		}

		if err := correlateElement(wrappedState, pair.Element); err != nil {
			return nil, fmt.Errorf("dump malformed on element %d: %s", i, err)
		}
	}

	if wrappedState.LSIFVersion == "" {
		return nil, ErrMissingMetaData
	}

	return wrappedState.State, nil
}

type wrappedState struct {
	*State
	dumpRoot            string
	unsupportedVertices *datastructures.IDSet
}

func newWrappedState(dumpRoot string) *wrappedState {
	return &wrappedState{
		State:               newState(),
		dumpRoot:            dumpRoot,
		unsupportedVertices: datastructures.NewIDSet(),
	}
}

// correlateElement maps a single vertex or edge element into the correlation state.
func correlateElement(state *wrappedState, element lsif.Element) error {
	switch element.Type {
	case "vertex":
		return correlateVertex(state, element)
	case "edge":
		return correlateEdge(state, element)
	}

	return fmt.Errorf("unknown element type %s", element.Type)
}

var vertexHandlers = map[string]func(state *wrappedState, element lsif.Element) error{
	"metaData":             correlateMetaData,
	"document":             correlateDocument,
	"range":                correlateRange,
	"resultSet":            correlateResultSet,
	"definitionResult":     correlateDefinitionResult,
	"referenceResult":      correlateReferenceResult,
	"hoverResult":          correlateHoverResult,
	"moniker":              correlateMoniker,
	"packageInformation":   correlatePackageInformation,
	"symbol":               correlateSymbol,
	"diagnosticResult":     correlateDiagnosticResult,
	"documentSymbolResult": correlateDocumentSymbolResult,
}

// correlateElement maps a single vertex element into the correlation state.
func correlateVertex(state *wrappedState, element lsif.Element) error {
	handler, ok := vertexHandlers[element.Label]
	if !ok {
		// Can safely skip, but need to mark this in case we have an edge
		// later that legally refers to this element by identifier. If we
		// don't track this, item edges related to something other than a
		// definition or reference result will result in a spurious error
		// although the LSIF index is valid.
		state.unsupportedVertices.Add(element.ID)
		return nil
	}

	return handler(state, element)
}

var edgeHandlers = map[string]func(state *wrappedState, id int, edge lsif.Edge) error{
	"contains":                    correlateContainsEdge,
	"next":                        correlateNextEdge,
	"item":                        correlateItemEdge,
	"textDocument/definition":     correlateTextDocumentDefinitionEdge,
	"textDocument/references":     correlateTextDocumentReferencesEdge,
	"textDocument/hover":          correlateTextDocumentHoverEdge,
	"moniker":                     correlateMonikerEdge,
	"nextMoniker":                 correlateNextMonikerEdge,
	"packageInformation":          correlatePackageInformationEdge,
	"textDocument/diagnostic":     correlateDiagnosticEdge,
	"textDocument/documentSymbol": correlateTextDocumentDocumentSymbolEdge,
	"workspace/symbol":            correlateWorkspaceSymbolEdge,
	"member":                      correlateMemberEdge,
}

// correlateElement maps a single edge element into the correlation state.
func correlateEdge(state *wrappedState, element lsif.Element) error {
	edge, ok := element.Payload.(lsif.Edge)
	if !ok {
		return ErrUnexpectedPayload
	}

	handler, ok := edgeHandlers[element.Label]
	if !ok {
		// We don't care, can safely skip
		return nil
	}

	return handler(state, element.ID, edge)
}

func correlateMetaData(state *wrappedState, element lsif.Element) error {
	payload, ok := element.Payload.(lsif.MetaData)
	if !ok {
		return ErrUnexpectedPayload
	}

	// We assume that the project root in the LSIF dump is either:
	//
	//   (1) the root of the LSIF dump, or
	//   (2) the root of the repository
	//
	// These are the common cases and we don't explicitly support
	// anything else. Here we normalize to (1) by appending the dump
	// root if it's not already suffixed by it.

	if !strings.HasSuffix(payload.ProjectRoot, "/") {
		payload.ProjectRoot += "/"
	}

	if state.dumpRoot != "" && !strings.HasSuffix(payload.ProjectRoot, "/"+state.dumpRoot) {
		payload.ProjectRoot += state.dumpRoot
	}

	state.LSIFVersion = payload.Version
	state.ProjectRoot = payload.ProjectRoot
	return nil
}

func correlateDocument(state *wrappedState, element lsif.Element) error {
	payload, ok := element.Payload.(string)
	if !ok {
		return ErrUnexpectedPayload
	}

	if state.ProjectRoot == "" {
		return ErrMissingMetaData
	}

	relativeURI, err := filepath.Rel(state.ProjectRoot, payload)
	if err != nil {
		return fmt.Errorf("document URI %q is not relative to project root %q (%s)", payload, state.ProjectRoot, err)
	}

	state.DocumentData[element.ID] = relativeURI
	return nil
}

func correlateRange(state *wrappedState, element lsif.Element) error {
	payload, ok := element.Payload.(lsif.Range)
	if !ok {
		return ErrUnexpectedPayload
	}

	state.RangeData[element.ID] = payload
	return nil
}

func correlateResultSet(state *wrappedState, element lsif.Element) error {
	state.ResultSetData[element.ID] = lsif.ResultSet{}
	return nil
}

func correlateDefinitionResult(state *wrappedState, element lsif.Element) error {
	state.DefinitionData[element.ID] = datastructures.NewDefaultIDSetMap()
	return nil
}

func correlateReferenceResult(state *wrappedState, element lsif.Element) error {
	state.ReferenceData[element.ID] = datastructures.NewDefaultIDSetMap()
	return nil
}

func correlateHoverResult(state *wrappedState, element lsif.Element) error {
	payload, ok := element.Payload.(string)
	if !ok {
		return ErrUnexpectedPayload
	}

	state.HoverData[element.ID] = payload
	return nil
}

func correlateMoniker(state *wrappedState, element lsif.Element) error {
	payload, ok := element.Payload.(lsif.Moniker)
	if !ok {
		return ErrUnexpectedPayload
	}

	state.MonikerData[element.ID] = payload
	return nil
}

func correlatePackageInformation(state *wrappedState, element lsif.Element) error {
	payload, ok := element.Payload.(lsif.PackageInformation)
	if !ok {
		return ErrUnexpectedPayload
	}

	state.PackageInformationData[element.ID] = payload
	return nil
}

func correlateSymbol(state *wrappedState, element lsif.Element) error {
	payload, ok := element.Payload.(protocol.Symbol)
	if !ok {
		return ErrUnexpectedPayload
	}

	for i := range payload.Locations {
		uri := payload.Locations[i].URI
		relativeURI, err := filepath.Rel(state.ProjectRoot, uri)
		if err != nil {
			return fmt.Errorf("symbol location URI %q is not relative to project root %q (%s)", uri, state.ProjectRoot, err)
		}
		payload.Locations[i].URI = relativeURI
	}

	state.SymbolData[element.ID] = payload
	return nil
}

func correlateDiagnosticResult(state *wrappedState, element lsif.Element) error {
	payload, ok := element.Payload.([]lsif.Diagnostic)
	if !ok {
		return ErrUnexpectedPayload
	}

	state.DiagnosticResults[element.ID] = payload
	return nil
}

func correlateDocumentSymbolResult(state *wrappedState, element lsif.Element) error {
	// TODO(sqs): support inline document symbols
	payload, ok := element.Payload.([]protocol.RangeBasedDocumentSymbol)
	if !ok {
		return ErrUnexpectedPayload
	}

	// TODO(sqs): validate that IDs and child IDs are all correct

	state.DocumentSymbolResults[element.ID] = payload
	return nil
}

func correlateContainsEdge(state *wrappedState, id int, edge lsif.Edge) error {
	if _, ok := state.DocumentData[edge.OutV]; !ok {
		// Do not track this relation for project vertices
		return nil
	}

	for _, inV := range edge.InVs {
		if _, ok := state.RangeData[inV]; !ok {
			return malformedDump(id, inV, "range")
		}
		state.Contains.SetAdd(edge.OutV, inV)
	}
	return nil
}

func correlateNextEdge(state *wrappedState, id int, edge lsif.Edge) error {
	if _, ok := state.ResultSetData[edge.InV]; !ok {
		return malformedDump(id, edge.InV, "resultSet")
	}

	if _, ok := state.RangeData[edge.OutV]; ok {
		state.NextData[edge.OutV] = edge.InV
	} else if _, ok := state.ResultSetData[edge.OutV]; ok {
		state.NextData[edge.OutV] = edge.InV
	} else {
		return malformedDump(id, edge.OutV, "range", "resultSet")
	}
	return nil
}

func correlateItemEdge(state *wrappedState, id int, edge lsif.Edge) error {
	if documentMap, ok := state.DefinitionData[edge.OutV]; ok {
		for _, inV := range edge.InVs {
			if _, ok := state.RangeData[inV]; !ok {
				return malformedDump(id, inV, "range")
			}

			// Link definition data to defining range
			documentMap.SetAdd(edge.Document, inV)
		}

		return nil
	}

	if documentMap, ok := state.ReferenceData[edge.OutV]; ok {
		for _, inV := range edge.InVs {
			if _, ok := state.ReferenceData[inV]; ok {
				// Link reference data identifiers together
				state.LinkedReferenceResults.Link(edge.OutV, inV)
			} else {
				if _, ok = state.RangeData[inV]; !ok {
					return malformedDump(id, inV, "range")
				}

				// Link reference data to a reference range
				documentMap.SetAdd(edge.Document, inV)
			}
		}

		return nil
	}

	if !state.unsupportedVertices.Contains(edge.OutV) {
		return malformedDump(id, edge.OutV, "vertex")
	}

	log15.Debug("Skipping edge from an unsupported vertex")
	return nil
}

func correlateTextDocumentDefinitionEdge(state *wrappedState, id int, edge lsif.Edge) error {
	if _, ok := state.DefinitionData[edge.InV]; !ok {
		return malformedDump(id, edge.InV, "definitionResult")
	}

	if source, ok := state.RangeData[edge.OutV]; ok {
		state.RangeData[edge.OutV] = source.SetDefinitionResultID(edge.InV)
	} else if source, ok := state.ResultSetData[edge.OutV]; ok {
		state.ResultSetData[edge.OutV] = source.SetDefinitionResultID(edge.InV)
	} else {
		return malformedDump(id, edge.OutV, "range", "resultSet")
	}
	return nil
}

func correlateTextDocumentReferencesEdge(state *wrappedState, id int, edge lsif.Edge) error {
	if _, ok := state.ReferenceData[edge.InV]; !ok {
		return malformedDump(id, edge.InV, "referenceResult")
	}

	if source, ok := state.RangeData[edge.OutV]; ok {
		state.RangeData[edge.OutV] = source.SetReferenceResultID(edge.InV)
	} else if source, ok := state.ResultSetData[edge.OutV]; ok {
		state.ResultSetData[edge.OutV] = source.SetReferenceResultID(edge.InV)
	} else {
		return malformedDump(id, edge.OutV, "range", "resultSet")
	}
	return nil
}

func correlateTextDocumentHoverEdge(state *wrappedState, id int, edge lsif.Edge) error {
	if _, ok := state.HoverData[edge.InV]; !ok {
		return malformedDump(id, edge.InV, "hoverResult")
	}

	if source, ok := state.RangeData[edge.OutV]; ok {
		state.RangeData[edge.OutV] = source.SetHoverResultID(edge.InV)
	} else if source, ok := state.ResultSetData[edge.OutV]; ok {
		state.ResultSetData[edge.OutV] = source.SetHoverResultID(edge.InV)
	} else {
		return malformedDump(id, edge.OutV, "range", "resultSet")
	}
	return nil
}

func correlateMonikerEdge(state *wrappedState, id int, edge lsif.Edge) error {
	if _, ok := state.MonikerData[edge.InV]; !ok {
		return malformedDump(id, edge.InV, "moniker")
	}

	if _, ok := state.RangeData[edge.OutV]; ok {
		state.Monikers.SetAdd(edge.OutV, edge.InV)
	} else if _, ok := state.ResultSetData[edge.OutV]; ok {
		state.Monikers.SetAdd(edge.OutV, edge.InV)
	} else if _, ok := state.SymbolData[edge.OutV]; ok {
		state.Monikers.SetAdd(edge.OutV, edge.InV)
	} else {
		return malformedDump(id, edge.OutV, "range", "resultSet")
	}
	return nil
}

func correlateNextMonikerEdge(state *wrappedState, id int, edge lsif.Edge) error {
	if _, ok := state.MonikerData[edge.InV]; !ok {
		return malformedDump(id, edge.InV, "moniker")
	}
	if _, ok := state.MonikerData[edge.OutV]; !ok {
		return malformedDump(id, edge.OutV, "moniker")
	}

	state.LinkedMonikers.Link(edge.InV, edge.OutV)
	return nil
}

func correlatePackageInformationEdge(state *wrappedState, id int, edge lsif.Edge) error {
	if _, ok := state.PackageInformationData[edge.InV]; !ok {
		return malformedDump(id, edge.InV, "packageInformation")
	}

	source, ok := state.MonikerData[edge.OutV]
	if !ok {
		return malformedDump(id, edge.OutV, "moniker")
	}
	state.MonikerData[edge.OutV] = source.SetPackageInformationID(edge.InV)

	switch source.Kind {
	case "import":
		// keep list of imported monikers
		state.ImportedMonikers.Add(edge.OutV)
	case "export":
		// keep list of exported monikers
		state.ExportedMonikers.Add(edge.OutV)
	}

	return nil
}

func correlateDiagnosticEdge(state *wrappedState, id int, edge lsif.Edge) error {
	if _, ok := state.DocumentData[edge.OutV]; !ok {
		return malformedDump(id, edge.OutV, "document")
	}

	if _, ok := state.DiagnosticResults[edge.InV]; !ok {
		return malformedDump(id, edge.InV, "diagnosticResult")
	}

	state.Diagnostics.SetAdd(edge.OutV, edge.InV)
	return nil
}

func correlateTextDocumentDocumentSymbolEdge(state *wrappedState, id int, edge lsif.Edge) error {
	if _, ok := state.DocumentData[edge.OutV]; !ok {
		return malformedDump(id, edge.OutV, "document")
	}

	if _, ok := state.DocumentSymbolResults[edge.InV]; !ok {
		return malformedDump(id, edge.InV, "documentSymbolResult")
	}

	state.DocumentSymbols.SetAdd(edge.OutV, edge.InV)
	return nil
}

func correlateWorkspaceSymbolEdge(state *wrappedState, id int, edge lsif.Edge) error {
	// TODO(sqs): can't validate that OutV is a project vertex because we don't track projects yet
	for _, inV := range edge.InVs {
		if _, ok := state.SymbolData[inV]; !ok {
			return malformedDump(id, inV, "symbol")
		}
		state.WorkspaceSymbols.Add(inV)
	}

	return nil
}

func correlateMemberEdge(state *wrappedState, id int, edge lsif.Edge) error {
	isSymbolOrRange := func(id int) bool {
		// TODO(sqs): also allow pointing to documentSymbolResult
		_, ok := state.SymbolData[id]
		if !ok {
			_, ok = state.RangeData[id]
		}
		return ok
	}

	if !isSymbolOrRange(edge.OutV) {
		return malformedDump(id, edge.OutV, "range", "symbol")
	}

	for _, inV := range edge.InVs {
		// Check that the edge points to a symbol.
		if !isSymbolOrRange(inV) {
			return malformedDump(id, inV, "range", "symbol")
		}
		state.Members.SetAdd(edge.OutV, inV)
	}
	return nil
}
