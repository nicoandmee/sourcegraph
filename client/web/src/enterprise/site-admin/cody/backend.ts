import { ApolloClient, MutationTuple } from '@apollo/client'
import { from, Observable } from 'rxjs'
import { map } from 'rxjs/operators'

import { dataOrThrowErrors, getDocumentNode, gql, useMutation } from '@sourcegraph/http-client'

import { FilteredConnectionQueryArguments } from '../../../components/FilteredConnection'
import {
    RepoEmbeddingJobsListResult,
    RepoEmbeddingJobsListVariables,
    RepoEmbeddingJobConnectionFields,
    ScheduleContextDetectionEmbeddingJobResult,
    ScheduleContextDetectionEmbeddingJobVariables,
    ScheduleRepoEmbeddingJobsResult,
    ScheduleRepoEmbeddingJobsVariables,
    CancelRepoEmbeddingJobResult,
    CancelRepoEmbeddingJobVariables,
} from '../../../graphql-operations'

const REPO_EMBEDDING_JOB_FRAGMENT = gql`
    fragment RepoEmbeddingJobFields on RepoEmbeddingJob {
        id
        state
        failureMessage
        finishedAt
        queuedAt
        startedAt
        repo {
            name
            url
        }
        revision {
            oid
            abbreviatedOID
        }
    }
`

const REPO_EMBEDDING_JOB_CONNECTION_FIELDS_FRAGMENT = gql`
    ${REPO_EMBEDDING_JOB_FRAGMENT}
    fragment RepoEmbeddingJobConnectionFields on RepoEmbeddingJobsConnection {
        totalCount
        pageInfo {
            endCursor
            hasNextPage
        }
        nodes {
            ...RepoEmbeddingJobFields
        }
    }
`

export const REPO_EMBEDDING_JOBS_LIST_QUERY = gql`
    ${REPO_EMBEDDING_JOB_CONNECTION_FIELDS_FRAGMENT}
    query RepoEmbeddingJobsList($first: Int, $after: String) {
        repoEmbeddingJobs(first: $first, after: $after) {
            ...RepoEmbeddingJobConnectionFields
        }
    }
`

export function repoEmbeddingJobs(
    variables: FilteredConnectionQueryArguments,
    apolloClient: ApolloClient<object>
): Observable<RepoEmbeddingJobConnectionFields> {
    return from(
        apolloClient.query<RepoEmbeddingJobsListResult, RepoEmbeddingJobsListVariables>({
            query: getDocumentNode(REPO_EMBEDDING_JOBS_LIST_QUERY),
            variables: {
                first: variables.first ?? null,
                after: variables.after ?? null,
            },
        })
    ).pipe(
        map(dataOrThrowErrors),
        map(data => data.repoEmbeddingJobs)
    )
}

export const CANCEL_REPO_EMBEDDING_JOB = gql`
    mutation CancelRepoEmbeddingJob($id: ID!) {
        cancelRepoEmbeddingJob(job: $id) {
            alwaysNil
        }
    }
`

export function useCancelRepoEmbeddingJob(): MutationTuple<
    CancelRepoEmbeddingJobResult,
    CancelRepoEmbeddingJobVariables
> {
    return useMutation<CancelRepoEmbeddingJobResult, CancelRepoEmbeddingJobVariables>(CANCEL_REPO_EMBEDDING_JOB)
}

export const SCHEDULE_REPO_EMBEDDING_JOBS = gql`
    mutation ScheduleRepoEmbeddingJobs($repoNames: [String!]!) {
        scheduleRepositoriesForEmbedding(repoNames: $repoNames) {
            alwaysNil
        }
    }
`

export function useScheduleRepoEmbeddingJobs(): MutationTuple<
    ScheduleRepoEmbeddingJobsResult,
    ScheduleRepoEmbeddingJobsVariables
> {
    return useMutation<ScheduleRepoEmbeddingJobsResult, ScheduleRepoEmbeddingJobsVariables>(
        SCHEDULE_REPO_EMBEDDING_JOBS
    )
}

export const SCHEDULE_CONTEXT_DETECTION_EMBEDDING_JOB = gql`
    mutation ScheduleContextDetectionEmbeddingJob {
        scheduleContextDetectionForEmbedding {
            alwaysNil
        }
    }
`

export function useScheduleContextDetectionEmbeddingJob(): MutationTuple<
    ScheduleContextDetectionEmbeddingJobResult,
    ScheduleContextDetectionEmbeddingJobVariables
> {
    return useMutation<ScheduleContextDetectionEmbeddingJobResult, ScheduleContextDetectionEmbeddingJobVariables>(
        SCHEDULE_CONTEXT_DETECTION_EMBEDDING_JOB
    )
}
