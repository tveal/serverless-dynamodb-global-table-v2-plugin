[![Gitpod Ready-to-Code](https://img.shields.io/badge/Gitpod-Ready--to--Code-blue?logo=gitpod)](https://gitpod.io/#https://github.com/tveal/serverless-dynamodb-global-table-v2-plugin.git)

# serverless-dynamodb-global-table-v2-plugin

This plugin provisions DynamoDB global tables for v2
([2019.11.21](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/V2globaltables.tutorial.html))

For v1
([2017.11.29](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/globaltables.tutorial.html)),
checkout the original plugins that this one is built from:
- [serverless-dynamodb-global-table-plugin](https://www.npmjs.com/package/serverless-dynamodb-global-table-plugin)
- [serverless-dynamodb-autoscaling-plugin](https://www.npmjs.com/package/serverless-dynamodb-autoscaling-plugin)

Some things different than v1:
- Tables to make global v2 can only be deployed to one region via Serverless
  resources (use a condition)
- The region you set the condition to true for the global table(s) must deploy
  first
- Referencing global table arn's by ref only work for the conditional region;
  this plugin supports a substitution feature (see [advanced](#Advanced))
- Autoscaling cannot be applied the same as v1 for non-primary regions; see
  [experimental](#Experimental)
- Deleting a global table v2 within 24 hours of creation, once it's been in-use
  requires first removing the replica(s); ex. if primary is east and secondary
  is west, delete the west replica, then you can delete the CloudFormation stack.
  To programmatically remove a replica from a global table v2, see the aws-sdk
  [sample](#Delete-Replica) at the bottom of this doc.

Deploy your stack to your primary region, this plugin will then add the regions
specified in the "addRegions" property to your table in the primary region,
turning it into a global table v2. Upon deploys to other region(s), this plugin
will check and add any missing regions (the primary region deploy should have
this done already).

## Install plugin:

```
npm install -D serverless-dynamodb-global-table-v2-plugin
```

## serverless.yml:

```yaml
plugins:
  - serverless-dynamodb-global-table-v2-plugin

custom:
  globalTablesV2:
    primaryRegion: us-east-1
    tables:
      - table: Table
        addRegions:
          - us-west-2

resources:
  Resources:
    Table:
      Type: AWS::DynamoDB::Table
      Condition: IsEast
      # ...

  Conditions:
    IsEast:
      Fn::Equals:
        - ${opt:region}
        - us-east-1
```

## Advanced

If you reference your global table(s) in other places in your serverless.yml,
such as:

```
Fn::GetAtt: [ Table1, Arn ]
Fn::GetAtt: [ Table1, StreamArn ]
```

then you can substitute these with something like:

```
subTable1Arn
subTable1StreamArn
```

The plugin will substitute the appropriate arn's.
- Primary region: local ref's
- Other regions: arn's retrieved from AWS API

```yaml
provider:
  # ...
  iamRoleStatements:
    - Effect: Allow
      Action:
        - dynamodb:Query
        - dynamodb:BatchWriteItem
        - dynamodb:GetItem
        - dynamodb:PutItem
        - dynamodb:UpdateItem
      Resource:
      # change from this:
        - Fn::GetAtt: [ Table1, Arn ]
        - Fn::GetAtt: [ Table2, Arn ]
      # to this:
        - subTable1Arn
        - subTable2Arn

functions:
  databaseFunction:
    handler: index.handle
    events:
      - stream:
          type: dynamodb
          # change from this:
          arn:
            Fn::GetAtt: [ Table1, StreamArn ]
          # to this:
          arn: subTable1StreamArn
          # ...
```

---

NOTE: Provisioning a global table takes a while, but this plugin uses the
DynamoDB API, which does not wait until the provisioning completes to end the
serverless deploy; If you deploy regions back-to-back, the additional region(s)
might not be ready for arn lookup, so the substitution feature has a retry
mechanism. If you need to adjust the built-in retry you can use the following
environment variables:

Variable                | Description                                             | Default
------------------------|---------------------------------------------------------|--------
GTV2_RETRY              | Total number of retries for getting table ARNs from AWS | 30
GTV2_RETRY_PAUSE_MILLIS | Millis to wait between each retry                       | 10000

This default configuration will wait up to 5 minutes for a global table to
complete provisioning, retrying every 10 seconds (10,000 millis * 30 = 5 minutes)

---

## Experimental

Since global tables v2 can only deploy via code to the primary region, applying
autoscaling to other regions is tricky. This plugin attempts to conditionally
apply the appropriate config per region.

To turn on:

1. Add the _autoscale_ property to _custom.globalTablesV2_

    ```yaml
    custom:
      globalTablesV2:
        primaryRegion: us-east-1
        autoscale: true
        tables:
          - table: Table1
            addRegions:
              - us-west-2
          - table: Table2
            addRegions:
              - us-west-2
    ```

2. Add read/write config per table

    ```yaml
    custom:
      globalTablesV2:
        primaryRegion: us-east-1
        autoscale: true
        tables:
          - table: Table1
            addRegions:
              - us-west-2
            read:
              minimum: 5
              maximum: 20
              usage: 0.6
              actions:
                - name: morning
                  minimum: 5
                  maximum: 20
                  schedule: cron(0 6 * * ? *)
                - name: night
                  minimum: 1
                  maximum: 1
                  schedule: cron(0 0 * * ? *)
            write:
              minimum: 5
              maximum: 50
              usage: 0.6
              actions:
                - name: morning
                  minimum: 5
                  maximum: 50
                  schedule: cron(0 6 * * ? *)
                - name: night
                  minimum: 1
                  maximum: 1
                  schedule: cron(0 0 * * ? *)
    ```

## Delete Replica

A sample for deleting a replica region from a DynamoDB global table v2

```js
const AWS = require('aws-sdk');

// https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/DynamoDB.html#updateTable-property
const main = async () => {
  const region = process.env.AWS_DEFAULT_REGION || 'us-east-1'
  const TableName = getRequiredEnvVar('TABLE_NAME');
  const RegionName = getRequiredEnvVar('DEL_REPLICA_REGION');

  const ddb = new AWS.DynamoDB({ region, apiVersion: '2012-08-10' });

  const params = {
    TableName,
    ReplicaUpdates: [{
      Delete: {
        RegionName, 
      }
    }],
  };

  const res = await ddb.updateTable(params).promise();
  console.log('update-table delete replica result:', res);
};

const getRequiredEnvVar = (varName) => {
  const val = process.env[varName];
  if (!val) {
    throw new Error(`Must provide env variable: ${varName}`);
  }
  return val;
}

main();
```