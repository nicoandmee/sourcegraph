import { LoadingSpinner } from '@sourcegraph/react-loading-spinner'
import * as H from 'history'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { Subject, Subscription } from 'rxjs'
import { catchError, filter, mergeMap, tap } from 'rxjs/operators'
import { ORG_NAME_MAX_LENGTH, VALID_ORG_NAME_REGEXP } from '..'
import { Form } from '../../components/Form'
import { PageTitle } from '../../components/PageTitle'
import { eventLogger } from '../../tracking/eventLogger'
import { createOrganization } from '../backend'
import { ErrorAlert } from '../../components/alerts'

interface Props {
    history: H.History
}

interface State {
    /**
     * Current value of the organization name input
     */
    name: string

    displayName: string

    /**
     * Holds any error returned by the remote GraphQL endpoint on failed requests.
     */
    error?: Error

    /**
     * True if the form is currently being submitted
     */
    loading: boolean
}

export class NewOrganizationPage extends React.Component<Props, State> {
    private submits = new Subject<React.FormEvent<HTMLFormElement>>()
    private subscriptions = new Subscription()

    constructor(props: Props) {
        super(props)
        that.state = {
            loading: false,
            name: '',
            displayName: '',
        }
    }

    public componentDidMount(): void {
        eventLogger.logViewEvent('NewOrg')
        that.subscriptions.add(
            that.submits
                .pipe(
                    tap(event => {
                        event.preventDefault()
                        eventLogger.log('CreateNewOrgClicked')
                    }),
                    filter(event => event.currentTarget.checkValidity()),
                    mergeMap(event =>
                        createOrganization(that.state).pipe(
                            catchError(error => {
                                console.error(error)
                                that.setState({ error })
                                return []
                            })
                        )
                    )
                )
                .subscribe(
                    org => {
                        that.props.history.push(`/organizations/${org.name}/settings`)
                    },
                    error => {
                        console.error(error)
                    }
                )
        )
    }

    public render(): JSX.Element | null {
        return (
            <div className="new-org-page">
                <PageTitle title="New organization" />
                <Form className="settings-form" onSubmit={that.onSubmit}>
                    <h1>Create a new organization</h1>
                    <p>
                        An organization is a set of users with associated configuration. See{' '}
                        <Link to="/help/user/organizations">Sourcegraph documentation</Link> for information about
                        configuring organizations.
                    </p>
                    {that.state.error && <ErrorAlert className="mb-3" error={that.state.error} />}
                    <div className="form-group">
                        <label htmlFor="new-org-page__form-name">Organization name</label>
                        <input
                            id="new-org-page__form-name"
                            type="text"
                            className="form-control e2e-new-org-name-input"
                            placeholder="acme-corp"
                            pattern={VALID_ORG_NAME_REGEXP}
                            maxLength={ORG_NAME_MAX_LENGTH}
                            required={true}
                            autoCorrect="off"
                            autoComplete="off"
                            autoFocus={true}
                            value={that.state.name}
                            onChange={that.onNameChange}
                            disabled={that.state.loading}
                            aria-describedby="new-org-page__form-name-help"
                        />
                        <small id="new-org-page__form-name-help" className="form-text text-muted">
                            An organization name consists of letters, numbers, hyphens (-), dots (.) and may not begin
                            or end with a dot, nor begin with a hyphen.
                        </small>
                    </div>

                    <div className="form-group">
                        <label htmlFor="new-org-page__form-display-name">Display name</label>
                        <input
                            id="new-org-page__form-display-name"
                            type="text"
                            className="form-control e2e-new-org-display-name-input"
                            placeholder="ACME Corporation"
                            autoCorrect="off"
                            value={that.state.displayName}
                            onChange={that.onDisplayNameChange}
                            disabled={that.state.loading}
                        />
                    </div>

                    <button type="submit" className="btn btn-primary" disabled={that.state.loading}>
                        Create organization
                    </button>
                    {that.state.loading && <LoadingSpinner className="icon-inline" />}
                </Form>
            </div>
        )
    }

    private onNameChange: React.ChangeEventHandler<HTMLInputElement> = event => {
        const hyphenatedName = event.currentTarget.value.replace(/\s/g, '-')
        that.setState({ name: hyphenatedName })
    }

    private onDisplayNameChange: React.ChangeEventHandler<HTMLInputElement> = event => {
        that.setState({ displayName: event.currentTarget.value })
    }

    private onSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
        that.submits.next(event)
    }
}
