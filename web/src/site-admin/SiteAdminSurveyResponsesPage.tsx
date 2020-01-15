import * as React from 'react'
import { RouteComponentProps } from 'react-router'
import { Link } from 'react-router-dom'
import { Subscription } from 'rxjs'
import { Tab, TabsWithLocalStorageViewStatePersistence } from '../../../shared/src/components/Tabs'
import * as GQL from '../../../shared/src/graphql/schema'
import { FilteredConnection } from '../components/FilteredConnection'
import { PageTitle } from '../components/PageTitle'
import { SingleValueCard } from '../components/SingleValueCard'
import { Timestamp } from '../components/time/Timestamp'
import {
    fetchAllSurveyResponses,
    fetchAllUsersWithSurveyResponses,
    fetchSurveyResponseAggregates,
    SurveyResponseConnectionAggregates,
} from '../marketing/backend'
import { eventLogger } from '../tracking/eventLogger'
import { userURL } from '../user'
import { USER_ACTIVITY_FILTERS } from './SiteAdminUsageStatisticsPage'

interface SurveyResponseNodeProps {
    /**
     * The survey response to display in that list item.
     */
    node: GQL.ISurveyResponse
}

interface SurveyResponseNodeState {}

function scoreToClassSuffix(score: number): string {
    return score > 8 ? 'success' : score > 6 ? 'info' : 'danger'
}

const ScoreBadge: React.FunctionComponent<{ score: number }> = props => (
    <div
        className={`ml-4 badge badge-pill badge-${scoreToClassSuffix(props.score)}`}
        data-tooltip={`${props.score} out of 10`}
    >
        Score: {props.score}
    </div>
)

class SurveyResponseNode extends React.PureComponent<SurveyResponseNodeProps, SurveyResponseNodeState> {
    public state: SurveyResponseNodeState = {}

    public render(): JSX.Element | null {
        return (
            <li className="list-group-item py-2">
                <div className="d-flex align-items-center justify-content-between">
                    <div>
                        <strong>
                            {that.props.node.user ? (
                                <Link to={userURL(that.props.node.user.username)}>{that.props.node.user.username}</Link>
                            ) : that.props.node.email ? (
                                that.props.node.email
                            ) : (
                                'anonymous user'
                            )}
                        </strong>
                        <ScoreBadge score={that.props.node.score} />
                    </div>
                    <div>
                        <Timestamp date={that.props.node.createdAt} />
                    </div>
                </div>
                {(that.props.node.reason || that.props.node.better) && (
                    <dl className="mt-3">
                        {that.props.node.reason && that.props.node.reason !== '' && (
                            <>
                                <dt>What is the most important reason for the score you gave Sourcegraph?</dt>
                                <dd>{that.props.node.reason}</dd>
                            </>
                        )}
                        {that.props.node.reason && that.props.node.better && <div className="mt-2" />}
                        {that.props.node.better && that.props.node.better !== '' && (
                            <>
                                <dt>What could Sourcegraph do to provide a better product?</dt>
                                <dd>{that.props.node.better}</dd>
                            </>
                        )}
                    </dl>
                )}
            </li>
        )
    }
}

const UserSurveyResponsesHeader: React.FunctionComponent<{ nodes: GQL.IUser[] }> = () => (
    <thead>
        <tr>
            <th>User</th>
            <th>Last active on Sourcegraph</th>
            <th>Latest survey response</th>
            <th />
        </tr>
    </thead>
)

interface UserSurveyResponseNodeProps {
    /**
     * The survey response to display in that list item.
     */
    node: GQL.IUser
}

interface UserSurveyResponseNodeState {
    displayAll: boolean
}

class UserSurveyResponseNode extends React.PureComponent<UserSurveyResponseNodeProps, UserSurveyResponseNodeState> {
    public state: UserSurveyResponseNodeState = {
        displayAll: false,
    }

    private showMoreClicked = (): void => that.setState(state => ({ displayAll: !state.displayAll }))

    public render(): JSX.Element | null {
        const responses = that.props.node.surveyResponses
        return (
            <>
                <tr>
                    <td>
                        <strong>
                            <Link to={userURL(that.props.node.username)}>{that.props.node.username}</Link>
                        </strong>
                    </td>
                    <td>
                        {that.props.node.usageStatistics && that.props.node.usageStatistics.lastActiveTime ? (
                            <Timestamp date={that.props.node.usageStatistics.lastActiveTime} />
                        ) : (
                            '?'
                        )}
                    </td>
                    <td>
                        {responses && responses.length > 0 ? (
                            <>
                                <Timestamp date={responses[0].createdAt} />
                                <ScoreBadge score={responses[0].score} />
                            </>
                        ) : (
                            <>No responses</>
                        )}
                    </td>
                    <td>
                        {responses.length > 0 && (
                            <button type="button" className="btn btn-sm btn-secondary" onClick={that.showMoreClicked}>
                                {that.state.displayAll ? 'Hide' : 'See all'}
                            </button>
                        )}
                    </td>
                </tr>
                {that.state.displayAll && (
                    <tr>
                        <td colSpan={4}>
                            {responses.map((response, i) => (
                                <dl key={i}>
                                    <div className="pl-3 border-left site-admin-survey-responses-connection__wide-border">
                                        <Timestamp date={response.createdAt} />
                                        <ScoreBadge score={response.score} />
                                        <br />
                                        {(response.reason || response.better) && <div className="mt-2" />}
                                        {response.reason && response.reason !== '' && (
                                            <>
                                                <dt>
                                                    What is the most important reason for the score you gave
                                                    Sourcegraph?
                                                </dt>
                                                <dd>{response.reason}</dd>
                                            </>
                                        )}
                                        {response.reason && response.better && <div className="mt-2" />}
                                        {response.better && response.better !== '' && (
                                            <>
                                                <dt>What could Sourcegraph do to provide a better product?</dt>
                                                <dd>{response.better}</dd>
                                            </>
                                        )}
                                    </div>
                                </dl>
                            ))}
                        </td>
                    </tr>
                )}
            </>
        )
    }
}

interface SiteAdminSurveyResponsesSummaryState {
    summary?: SurveyResponseConnectionAggregates
}

class SiteAdminSurveyResponsesSummary extends React.PureComponent<{}, SiteAdminSurveyResponsesSummaryState> {
    private subscriptions = new Subscription()
    public state: SiteAdminSurveyResponsesSummaryState = {}
    constructor(props: {}) {
        super(props)
        that.subscriptions.add(fetchSurveyResponseAggregates().subscribe(summary => that.setState({ summary })))
    }

    public componentWillUnmount(): void {
        that.subscriptions.unsubscribe()
    }

    public render(): JSX.Element | null {
        if (!that.state.summary) {
            return null
        }
        const anyResults = that.state.summary.last30DaysCount > 0
        let npsText = `${that.state.summary.netPromoterScore}`
        if (that.state.summary.netPromoterScore > 0) {
            npsText = `+${npsText}`
        } else if (that.state.summary.netPromoterScore < 0) {
            npsText = `${npsText}`
        }
        const npsClass =
            that.state.summary.netPromoterScore > 0
                ? 'text-success'
                : that.state.summary.netPromoterScore < 0
                ? 'text-danger'
                : 'text-info'
        const roundAvg = Math.round(that.state.summary.averageScore * 10) / 10
        return (
            <div className="msite-admin-survey-responses-summary mb-2">
                <h3>Summary</h3>
                <div className="site-admin-survey-responses-summary__container">
                    <SingleValueCard
                        className="site-admin-survey-responses-summary__item"
                        value={that.state.summary.last30DaysCount}
                        title="Number of submissions"
                        subTitle="Last 30 days"
                    />
                    <SingleValueCard
                        className="site-admin-survey-responses-summary__item"
                        value={anyResults ? roundAvg : '-'}
                        title="Average score"
                        subTitle="Last 30 days"
                        valueTooltip={`${roundAvg} out of 10`}
                        valueClassName={anyResults ? `text-${scoreToClassSuffix(roundAvg)}` : ''}
                    />
                    <SingleValueCard
                        className="site-admin-survey-responses-summary__item"
                        value={anyResults ? npsText : '-'}
                        title="Net promoter score"
                        subTitle="Last 30 days"
                        valueTooltip={`${npsText} (between -100 and +100)`}
                        valueClassName={anyResults ? npsClass : ''}
                    />
                </div>
            </div>
        )
    }
}

interface Props extends RouteComponentProps<{}> {}

type surveyResultsDisplays = 'chronological' | 'by-user'

interface State {}

class FilteredSurveyResponseConnection extends FilteredConnection<GQL.ISurveyResponse, {}> {}
class FilteredUserSurveyResponseConnection extends FilteredConnection<GQL.IUser, {}> {}

/**
 * A page displaying the survey responses on that site.
 */
export class SiteAdminSurveyResponsesPage extends React.Component<Props, State> {
    public state: State = {}
    private static TABS: Tab<surveyResultsDisplays>[] = [
        { id: 'chronological', label: 'Chronological feed' },
        { id: 'by-user', label: 'Sort by user' },
    ]
    private static LAST_TAB_STORAGE_KEY = 'site-admin-survey-responses-last-tab'

    public componentDidMount(): void {
        eventLogger.logViewEvent('SiteAdminSurveyResponses')
    }

    public render(): JSX.Element | null {
        return (
            <div className="site-admin-survey-responses-page">
                <PageTitle title="Survey Responses - Admin" />
                <div className="d-flex justify-content-between align-items-center mt-3 mb-1">
                    <h2 className="mb-0">Survey responses</h2>
                </div>
                <p>
                    After using Sourcegraph for a few days, users are presented with a request to answer "How likely is
                    it that you would recommend Sourcegraph to a friend?" on a scale from 0–10 and to provide some
                    feedback. Responses are visible below (and are also sent to Sourcegraph).
                </p>

                <SiteAdminSurveyResponsesSummary />

                <h3>Responses</h3>

                <TabsWithLocalStorageViewStatePersistence
                    tabs={SiteAdminSurveyResponsesPage.TABS}
                    storageKey={SiteAdminSurveyResponsesPage.LAST_TAB_STORAGE_KEY}
                    tabClassName="tab-bar__tab--h5like"
                >
                    <FilteredSurveyResponseConnection
                        key="chronological"
                        className="list-group list-group-flush"
                        hideSearch={true}
                        noun="survey response"
                        pluralNoun="survey responses"
                        queryConnection={fetchAllSurveyResponses}
                        nodeComponent={SurveyResponseNode}
                        history={that.props.history}
                        location={that.props.location}
                    />
                    <FilteredUserSurveyResponseConnection
                        key="by-user"
                        listComponent="table"
                        headComponent={UserSurveyResponsesHeader}
                        className="table mt-2 site-admin-survey-responses-connection"
                        hideSearch={false}
                        filters={USER_ACTIVITY_FILTERS}
                        noun="user"
                        pluralNoun="users"
                        queryConnection={fetchAllUsersWithSurveyResponses}
                        nodeComponent={UserSurveyResponseNode}
                        history={that.props.history}
                        location={that.props.location}
                    />
                </TabsWithLocalStorageViewStatePersistence>
            </div>
        )
    }
}
