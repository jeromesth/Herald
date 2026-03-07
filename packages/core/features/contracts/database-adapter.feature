Feature: Database Adapter Contract
  As a Herald developer
  I want every DatabaseAdapter implementation to behave consistently
  So that I can swap adapters without breaking functionality

  Background:
    Given a fresh database adapter

  # === CREATE ===

  Scenario: Create a record and return it
    When I create a "subscriber" with data:
      | field      | value            |
      | id         | 1                |
      | externalId | user-1           |
      | email      | test@example.com |
    Then the result should contain:
      | field      | value            |
      | id         | 1                |
      | externalId | user-1           |
      | email      | test@example.com |

  Scenario: Create with select projection
    When I create a "subscriber" with data and select "id,email":
      | field      | value            |
      | id         | 1                |
      | externalId | user-1           |
      | email      | test@example.com |
    Then the result should contain:
      | field | value            |
      | id    | 1                |
      | email | test@example.com |
    And the result should not contain field "externalId"

  # === FIND ONE ===

  Scenario: Find one by single where clause
    Given the following "subscriber" records exist:
      | id | externalId | email            |
      | 1  | user-1     | test@example.com |
    When I find one "subscriber" where "externalId" equals "user-1"
    Then the result should not be null
    And the result field "email" should equal "test@example.com"

  Scenario: Find one by multiple where clauses (AND)
    Given the following "subscriber" records exist:
      | id | externalId | email             |
      | 1  | user-1     | test@example.com  |
      | 2  | user-2     | other@example.com |
    When I find one "subscriber" where "externalId" equals "user-1" and "email" equals "test@example.com"
    Then the result should not be null
    And the result field "id" should equal "1"

  Scenario: Find one returns null when not found
    When I find one "subscriber" where "externalId" equals "nonexistent"
    Then the result should be null

  Scenario: Find one with select projection
    Given the following "subscriber" records exist:
      | id | externalId | email            |
      | 1  | user-1     | test@example.com |
    When I find one "subscriber" where "id" equals "1" with select "id,email"
    Then the result should contain:
      | field | value            |
      | id    | 1                |
      | email | test@example.com |

  # === FIND MANY ===

  Scenario: Find many returns all records when no where clause
    Given the following "item" records exist:
      | id | name  | order |
      | 1  | Alpha | 3     |
      | 2  | Beta  | 1     |
      | 3  | Gamma | 2     |
    When I find many "item"
    Then I should get 3 results

  Scenario: Find many filters by where clause
    Given the following "item" records exist:
      | id | name  | order |
      | 1  | Alpha | 3     |
      | 2  | Beta  | 1     |
      | 3  | Gamma | 2     |
    When I find many "item" where "name" equals "Beta"
    Then I should get 1 result

  Scenario: Find many supports limit
    Given the following "item" records exist:
      | id | name  | order |
      | 1  | Alpha | 3     |
      | 2  | Beta  | 1     |
      | 3  | Gamma | 2     |
    When I find many "item" with limit 2
    Then I should get 2 results

  Scenario: Find many supports offset
    Given the following "item" records exist:
      | id | name  | order |
      | 1  | Alpha | 3     |
      | 2  | Beta  | 1     |
      | 3  | Gamma | 2     |
    When I find many "item" with limit 2 and offset 1
    Then I should get 2 results

  Scenario: Find many supports sortBy asc
    Given the following "item" records exist:
      | id | name  | order |
      | 1  | Alpha | 3     |
      | 2  | Beta  | 1     |
      | 3  | Gamma | 2     |
    When I find many "item" sorted by "order" "asc"
    Then the first result field "order" should equal "1"
    And the last result field "order" should equal "3"

  Scenario: Find many supports sortBy desc
    Given the following "item" records exist:
      | id | name  | order |
      | 1  | Alpha | 3     |
      | 2  | Beta  | 1     |
      | 3  | Gamma | 2     |
    When I find many "item" sorted by "order" "desc"
    Then the first result field "order" should equal "3"
    And the last result field "order" should equal "1"

  Scenario: Find many handles empty results
    Given the following "item" records exist:
      | id | name  |
      | 1  | Alpha |
    When I find many "item" where "name" equals "Nonexistent"
    Then I should get 0 results

  Scenario: Find many supports select projection
    Given the following "item" records exist:
      | id | name  | order |
      | 1  | Alpha | 3     |
    When I find many "item" with select "id" and limit 1
    Then I should get 1 result
    And the first result should only contain field "id"

  # === COUNT ===

  Scenario: Count all records
    Given the following "item" records exist:
      | id |
      | 1  |
      | 2  |
    When I count "item"
    Then the count should be 2

  Scenario: Count with where filter
    Given the following "item" records exist:
      | id | active |
      | 1  | true   |
      | 2  | false  |
    When I count "item" where "active" equals "true"
    Then the count should be 1

  # === UPDATE ===

  Scenario: Update single record
    Given the following "subscriber" records exist:
      | id | externalId | email            |
      | 1  | user-1     | old@example.com  |
    When I update "subscriber" where "id" equals "1" with:
      | field | value            |
      | email | new@example.com  |
    Then the result field "email" should equal "new@example.com"

  Scenario: Update returns the full updated record
    Given the following "subscriber" records exist:
      | id | externalId | email            |
      | 1  | user-1     | old@example.com  |
    When I update "subscriber" where "id" equals "1" with:
      | field | value            |
      | email | new@example.com  |
    Then the result field "id" should equal "1"
    And the result field "externalId" should equal "user-1"

  Scenario: Update throws when record not found
    When I update "subscriber" where "id" equals "nonexistent" with:
      | field | value            |
      | email | new@example.com  |
    Then it should throw an error

  # === UPDATE MANY ===

  Scenario: Update many matching records
    Given the following "item" records exist:
      | id | active |
      | 1  | false  |
      | 2  | false  |
      | 3  | true   |
    When I update many "item" where "active" equals "false" with:
      | field  | value |
      | active | true  |
    Then the update count should be 2

  Scenario: Update many returns count
    Given the following "item" records exist:
      | id | status  |
      | 1  | pending |
    When I update many "item" where "status" equals "pending" with:
      | field  | value |
      | status | done  |
    Then the update count should be 1

  # === DELETE ===

  Scenario: Delete single record
    Given the following "subscriber" records exist:
      | id | externalId |
      | 1  | user-1     |
    When I delete "subscriber" where "id" equals "1"
    And I find one "subscriber" where "id" equals "1"
    Then the result should be null

  Scenario: Delete throws when record not found
    When I delete "subscriber" where "id" equals "nonexistent"
    Then it should throw an error

  # === DELETE MANY ===

  Scenario: Delete many matching records
    Given the following "item" records exist:
      | id | archived |
      | 1  | true     |
      | 2  | true     |
      | 3  | false    |
    When I delete many "item" where "archived" equals "true"
    Then the delete count should be 2

  Scenario: Delete many returns count
    Given the following "item" records exist:
      | id |
      | 1  |
      | 2  |
    When I delete many "item"
    Then the delete count should be 2

  # === WHERE OPERATORS ===

  Scenario Outline: Where operator <operator>
    Given the following "item" records exist:
      | id | value | name        |
      | 1  | 10    | hello world |
      | 2  | 20    | foo bar     |
      | 3  | 30    | hello there |
    When I find many "item" where "<field>" <operator> "<operand>"
    Then I should get <count> result

    Examples:
      | field | operator    | operand     | count |
      | value | eq          | 10          | 1     |
      | value | ne          | 10          | 2     |
      | value | lt          | 20          | 1     |
      | value | lte         | 20          | 2     |
      | value | gt          | 15          | 2     |
      | value | gte         | 20          | 2     |
      | value | in          | 10,30       | 2     |
      | value | not_in      | 10,30       | 1     |
      | name  | contains    | hello       | 2     |
      | name  | starts_with | hello       | 2     |
      | name  | ends_with   | bar         | 1     |

  # === AND/OR CONNECTORS ===

  Scenario: AND-only conditions
    Given the following "item" records exist:
      | id | value | name  |
      | 1  | 10    | alpha |
      | 2  | 20    | beta  |
      | 3  | 30    | gamma |
    When I find many "item" where "value" equals "10" and "name" equals "alpha"
    Then I should get 1 result

  Scenario: OR-only conditions
    Given the following "item" records exist:
      | id | value | name  |
      | 1  | 10    | alpha |
      | 2  | 20    | beta  |
      | 3  | 30    | gamma |
    When I find many "item" where "value" equals "10" or "value" equals "30"
    Then I should get 2 results

  Scenario: Mixed AND+OR conditions
    Given the following "item" records exist:
      | id | value | name  |
      | 1  | 10    | alpha |
      | 2  | 20    | beta  |
      | 3  | 30    | gamma |
    When I find many "item" where "name" equals "alpha" or "name" equals "beta"
    Then I should get 2 results
