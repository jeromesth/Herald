Feature: Workflow Adapter Contract
  As a Herald developer
  I want every WorkflowAdapter to behave consistently
  So that I can swap workflow engines without breaking functionality

  Background:
    Given a fresh workflow adapter

  # === ADAPTER ID ===

  Scenario: Adapter has a non-empty identifier
    Then the adapter ID should be a non-empty string

  # === REGISTER WORKFLOW ===

  Scenario: Register a workflow for later trigger
    When I register a workflow with ID "welcome"
    Then the workflow should be accepted without error

  Scenario: Register multiple workflows
    When I register a workflow with ID "wf-1"
    And I register a workflow with ID "wf-2"
    Then both workflows should be accepted without error

  # === TRIGGER ===

  Scenario: Trigger returns transactionId and status
    Given a registered workflow with ID "welcome"
    When I trigger "welcome" for recipient "user-1" with payload:
      | field | value   |
      | app   | TestApp |
    Then the result should have a non-empty transactionId
    And the status should be "triggered" or "queued"

  Scenario: Trigger generates transactionId if not provided
    Given a registered workflow with ID "welcome"
    When I trigger "welcome" for recipient "user-1" with empty payload
    Then the result should have a non-empty transactionId

  Scenario: Trigger uses provided transactionId when given
    Given a registered workflow with ID "welcome"
    When I trigger "welcome" for recipient "user-1" with transactionId "custom-tx-123"
    Then the transactionId should be "custom-tx-123"

  Scenario: Trigger handles single recipient
    Given a registered workflow with ID "welcome"
    When I trigger "welcome" for recipient "user-1" with empty payload
    Then the result should have a non-empty transactionId

  Scenario: Trigger handles array of recipients
    Given a registered workflow with ID "welcome"
    When I trigger "welcome" for recipients "user-1,user-2,user-3" with empty payload
    Then the result should have a non-empty transactionId
    And the status should be "triggered" or "queued"

  # === CANCEL ===

  Scenario: Cancel sends cancellation for given transactionId
    Given a registered workflow with ID "welcome"
    And I have triggered "welcome" for recipient "user-1"
    When I cancel "welcome" with the triggered transactionId
    Then it should resolve without error

  Scenario: Cancel does not throw for unknown transactionId
    When I cancel "welcome" with transactionId "nonexistent-tx"
    Then it should resolve without error

  # === GET HANDLER ===

  Scenario: getHandler returns null or a valid handler object
    Then getHandler should return null or a handler with path and function
