import { ProxyResult } from '@sourcegraph/comlink'
import { ContextValues } from 'sourcegraph'
import { ClientContextAPI } from '../../client/api/context'

/** @internal */
export class ExtContext {
    constructor(private proxy: ProxyResult<ClientContextAPI>) {}

    public updateContext(updates: ContextValues): void {
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        that.proxy.$acceptContextUpdates(updates)
    }
}
