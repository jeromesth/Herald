Feature: Notification Lifecycle
  Herald tracks in-app notifications for subscribers.
  Notifications can be listed, filtered, paginated, and marked as read/seen/archived.

  Background:
    Given a fresh Herald instance
    And a subscriber "user-1" exists with email "alice@example.com"

  Scenario: List notifications returns empty initially
    When I list notifications for subscriber "user-1"
    Then I should receive 0 notifications
    And the total count should be 0

  Scenario: Notifications appear after workflow trigger
    Given I trigger the "welcome" workflow for subscriber "user-1"
    When I list notifications for subscriber "user-1"
    Then I should receive at least 1 notification

  Scenario: List notifications supports pagination with limit
    Given I trigger the "welcome" workflow for subscriber "user-1" 3 times
    When I list notifications for subscriber "user-1" with limit 2
    Then I should receive 2 notifications

  Scenario: List notifications supports pagination with offset
    Given I trigger the "welcome" workflow for subscriber "user-1" 3 times
    When I list notifications for subscriber "user-1" with limit 2 and offset 2
    Then I should receive 1 notification

  Scenario: Filter notifications by unread status
    Given I trigger the "welcome" workflow for subscriber "user-1"
    When I list notifications for subscriber "user-1" filtered by read false
    Then I should receive at least 1 notification

  Scenario: Mark notification as read
    Given I trigger the "welcome" workflow for subscriber "user-1"
    And I have the first notification ID for subscriber "user-1"
    When I mark the notification as "read"
    And I list notifications for subscriber "user-1" filtered by read true
    Then I should receive 1 notification

  Scenario: Mark notification as seen
    Given I trigger the "welcome" workflow for subscriber "user-1"
    And I have the first notification ID for subscriber "user-1"
    When I mark the notification as "seen"
    And I list notifications for subscriber "user-1" filtered by seen true
    Then I should receive 1 notification

  Scenario: Mark notification as archived
    Given I trigger the "welcome" workflow for subscriber "user-1"
    And I have the first notification ID for subscriber "user-1"
    When I mark the notification as "archived"
    And I list notifications for subscriber "user-1" filtered by archived true
    Then I should receive 1 notification

  Scenario: Mark all notifications as read
    Given I trigger the "welcome" workflow for subscriber "user-1" 3 times
    And I have all notification IDs for subscriber "user-1"
    When I mark all notifications as "read"
    And I list notifications for subscriber "user-1" filtered by read false
    Then I should receive 0 notifications
