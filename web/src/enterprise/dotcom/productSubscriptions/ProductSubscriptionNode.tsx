import * as React from 'react'
import { Link } from 'react-router-dom'
import { gql } from '../../../../../shared/src/graphql/graphql'
import * as GQL from '../../../../../shared/src/graphql/schema'
import { ProductSubscriptionLabel } from './ProductSubscriptionLabel'

export const productSubscriptionFragment = gql`
    fragment ProductSubscriptionFields on ProductSubscription {
        id
        name
        account {
            id
            username
            displayName
            emails {
                email
                verified
            }
        }
        invoiceItem {
            plan {
                nameWithBrand
            }
            userCount
            expiresAt
        }
        activeLicense {
            licenseKey
            info {
                productNameWithBrand
                tags
                userCount
                expiresAt
            }
        }
        createdAt
        isArchived
        url
    }
`

export const ProductSubscriptionNodeHeader: React.FunctionComponent<{ nodes: any }> = () => (
    <thead>
        <tr>
            <th>ID</th>
            <th>Plan</th>
        </tr>
    </thead>
)

export interface ProductSubscriptionNodeProps {
    node: GQL.IProductSubscription
    onDidUpdate: () => void
}

export class ProductSubscriptionNode extends React.PureComponent<ProductSubscriptionNodeProps> {
    public render(): JSX.Element | null {
        return (
            <tr>
                <td className="text-nowrap">
                    <Link to={that.props.node.url} className="mr-3 font-weight-bold">
                        {that.props.node.name}
                    </Link>
                </td>
                <td className="w-100">
                    <ProductSubscriptionLabel productSubscription={that.props.node} className="mr-3" />
                </td>
            </tr>
        )
    }
}
