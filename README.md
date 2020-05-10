[![Gitpod Ready-to-Code](https://img.shields.io/badge/Gitpod-Ready--to--Code-blue?logo=gitpod)](https://gitpod.io/#https://github.com/tveal/serverless-dynamodb-global-table-v2-plugin.git) 

# serverless-dynamodb-global-table-v2-plugin

This plugin provisions DynamoDB global tables for v2 ([2019.11.21](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/V2globaltables.tutorial.html))

For v1 ([2017.11.29](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/globaltables.tutorial.html)), checkout the original plugins that this one is built from:
- [serverless-dynamodb-global-table-plugin](https://www.npmjs.com/package/serverless-dynamodb-global-table-plugin)
- [serverless-dynamodb-autoscaling-plugin](https://www.npmjs.com/package/serverless-dynamodb-autoscaling-plugin)

Some things different than v1:
- Tables to make global can only be deployed to one region via Serverless resources (use a condition)
- The region you set the condition to true for the global table(s) must deploy first
- Referencing global table arn's by ref only work for the conditional region; this plugin supports a substitution feature (see [advanced](#Advanced))
- Autoscaling cannot be applied the same as v1 for non-primary regions; see [experimental](#Experimental)

Deploy your stack to your primary region, this plugin will then add the regions specified in the "addRegions" property to your table in the primary region, turning it into a global table v2. Upon deploys to other region(s), this plugin will check and add any missing regions (the primary region deploy should have this done already).

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

If you reference your global table(s) in other places in your serverless.yml, such as:
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
- Conditional region: local ref's (as long as it's not in the `custom.autoscaling[table].addRegions` list)
- Other regions: arn's retrieved from AWS API

```yml
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

 ## Experimental

Since global tables V2 can only deploy via code to the primary region, applying autoscaling to other regions is tricky. This plugin attempts to conditionally apply the appropriate config per region.

To turn on:

1. Add the _primaryRegion_ and _autoscale_ properties to _custom.globalTablesV2_

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
