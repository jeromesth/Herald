Feature: Subscriber Management
  Herald manages subscribers that receive notifications.
  Subscribers are identified by an external ID and can have contact details
  used for channel-specific delivery.

  Background:
    Given a fresh Herald instance

  # === UPSERT ===

  Scenario: Create a new subscriber via upsert
    When I upsert a subscriber with externalId "user-1" and email "alice@example.com"
    Then the upsert should return an internal ID
    And I should be able to retrieve subscriber "user-1"

  Scenario: Update existing subscriber via upsert preserves unchanged fields
    Given a subscriber "user-1" exists with email "alice@example.com" and phone "+15551234567"
    When I upsert subscriber "user-1" with only email "alice-new@example.com"
    Then subscriber "user-1" should have email "alice-new@example.com"
    And subscriber "user-1" should have phone "+15551234567"

  # === GET ===

  Scenario: Get subscriber by externalId
    Given a subscriber "user-1" exists with email "alice@example.com"
    When I get subscriber "user-1"
    Then the subscriber should have externalId "user-1"
    And the subscriber should have email "alice@example.com"

  Scenario: Get subscriber returns null for unknown ID
    When I get subscriber "nonexistent"
    Then the subscriber should be null

  # === DELETE ===

  Scenario: Delete subscriber
    Given a subscriber "user-1" exists with email "alice@example.com"
    When I delete subscriber "user-1"
    Then subscriber "user-1" should no longer exist

  # === RESOLUTION ===

  Scenario: Resolve subscriber by externalId
    Given a subscriber "user-1" exists with email "alice@example.com"
    When I resolve subscriber by value "user-1"
    Then the resolved subscriber should have externalId "user-1"

  Scenario: Resolve subscriber by internal ID
    Given a subscriber "user-1" exists with email "alice@example.com"
    When I resolve subscriber by its internal ID
    Then the resolved subscriber should have externalId "user-1"

  # === RECIPIENT RESOLUTION ===

  Scenario: Resolve recipient for email channel returns email
    Given a subscriber "user-1" exists with email "alice@example.com"
    When I resolve the recipient for channel "email"
    Then the recipient should be "alice@example.com"

  Scenario: Resolve recipient for in_app channel returns internal ID
    Given a subscriber "user-1" exists with email "alice@example.com"
    When I resolve the recipient for channel "in_app"
    Then the recipient should be the subscriber's internal ID

  Scenario: Resolve recipient for sms channel returns phone
    Given a subscriber "user-1" exists with email "alice@example.com" and phone "+15551234567"
    When I resolve the recipient for channel "sms"
    Then the recipient should be "+15551234567"

  Scenario: Resolve recipient returns null when field is missing
    Given a subscriber "user-1" exists with email "alice@example.com"
    When I resolve the recipient for channel "sms"
    Then the recipient should be null
