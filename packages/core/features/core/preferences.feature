Feature: Subscriber Preferences
  Herald allows subscribers to control their notification preferences
  at the channel, workflow, and category levels. Updates use PATCH semantics
  so unmodified preferences are preserved.

  Background:
    Given a fresh Herald instance
    And a subscriber "user-1" exists with email "alice@example.com"

  Scenario: Get preferences returns defaults when none stored
    When I get preferences for subscriber "user-1"
    Then the preferences should have subscriberId matching "user-1"
    And the preferences channels should be empty

  Scenario: Get preferences returns configured defaults
    Given a Herald instance with default preferences disabling "sms"
    And a subscriber "user-2" exists with email "bob@example.com"
    When I get preferences for subscriber "user-2"
    Then the preferences channel "sms" should be false

  Scenario: Update channel preference
    When I update preferences for subscriber "user-1" setting channel "email" to false
    Then the returned preferences channel "email" should be false

  Scenario: Update preserves unmodified preferences
    When I update preferences for subscriber "user-1" setting channel "email" to false
    And I update preferences for subscriber "user-1" setting channel "sms" to false
    Then the returned preferences channel "email" should be false
    And the returned preferences channel "sms" should be false

  Scenario: Update workflow-level preference
    When I update preferences for subscriber "user-1" setting workflow "welcome" to false
    Then the returned preferences workflow "welcome" should be false

  Scenario: Update category-level preference
    When I update preferences for subscriber "user-1" setting category "marketing" to false
    Then the returned preferences category "marketing" should be false

  Scenario: Preferences created on first update
    When I update preferences for subscriber "user-1" setting channel "push" to true
    And I get preferences for subscriber "user-1"
    Then the preferences channel "push" should be true

  Scenario: Default preferences reflect config
    Given a Herald instance with default preferences disabling "email"
    And a subscriber "user-3" exists with email "charlie@example.com"
    When I get preferences for subscriber "user-3"
    Then the preferences channel "email" should be false
