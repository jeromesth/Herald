Feature: Workflow Trigger
  The trigger API is Herald's main entry point for sending notifications.
  It supports single and bulk recipients, custom transaction IDs,
  and plugin lifecycle hooks.

  Background:
    Given a fresh Herald instance with a "welcome" workflow

  Scenario: Trigger returns a transactionId
    When I trigger workflow "welcome" for subscriber "user-1"
    Then the trigger result should have a transactionId

  Scenario: Trigger with custom transactionId
    When I trigger workflow "welcome" for subscriber "user-1" with transactionId "tx-custom-123"
    Then the trigger transactionId should be "tx-custom-123"

  Scenario: Trigger for multiple recipients
    When I trigger workflow "welcome" for subscribers "user-1,user-2,user-3"
    Then the trigger result should have a transactionId

  Scenario: Plugin beforeTrigger hook runs before trigger
    Given a plugin with a "beforeTrigger" hook that records calls
    And a fresh Herald instance with the plugin and a "welcome" workflow
    When I trigger workflow "welcome" for subscriber "user-1"
    Then the "beforeTrigger" hook should have been called

  Scenario: Plugin afterTrigger hook runs after trigger
    Given a plugin with an "afterTrigger" hook that records calls
    And a fresh Herald instance with the plugin and a "welcome" workflow
    When I trigger workflow "welcome" for subscriber "user-1"
    Then the "afterTrigger" hook should have been called
