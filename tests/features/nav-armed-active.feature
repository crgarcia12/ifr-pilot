Feature: NAV Mode with Armed and Active States

  Background:
    Given the IFR Pilot game is loaded in the browser
    And the aircraft is at coordinates (47.50, -122.50) at 3000 feet
    And the aircraft is flying heading 090 at 120 knots
    And a programmed flight path exists through VOR station at (47.435, -122.309)

  Scenario: Engage NAV far from flight path arms the mode
    Given the aircraft is 2 nautical miles from the VOR course
    When the player clicks the NAV button
    Then the NAV button displays with an orange background
    And the aircraft continues on its current heading 090
    And the NAV mode status shows "ARMED"

  Scenario: Armed NAV activates when within intercept range
    Given NAV mode is armed (orange button)
    And the aircraft is 0.6 nautical miles from the VOR course centerline
    When the aircraft flies closer and reaches 0.4 nautical miles from the centerline
    Then the NAV button changes to a green background
    And the aircraft begins turning toward the course
    And the NAV mode status shows "ACTIVE"

  Scenario: Engage NAV while on course immediately activates
    Given the aircraft is 0.2 nautical miles from the VOR course centerline
    And the aircraft heading is within 20 degrees of the VOR course
    When the player clicks the NAV button
    Then the NAV button displays with a green background
    And the aircraft immediately adjusts heading to track the course
    And the NAV mode status shows "ACTIVE"

  Scenario: Disengage NAV from armed state
    Given NAV mode is armed (orange button)
    And the aircraft is flying on heading 180
    When the player clicks the NAV button again
    Then the NAV button returns to the default gray appearance
    And the NAV mode status shows "OFF"
    And the aircraft continues on heading 180 without autopilot corrections

  Scenario: Disengage NAV from active state
    Given NAV mode is active (green button)
    And the aircraft is tracking the VOR course
    When the player clicks the NAV button again
    Then the NAV button returns to the default gray appearance
    And autopilot steering stops
    And the aircraft maintains its current heading without further course corrections
    And the NAV mode status shows "OFF"

  Scenario: Active NAV tracks the flight path
    Given NAV mode is active (green button)
    And the aircraft is 0.1 nautical miles left of the VOR course centerline
    And the VOR course is 090 degrees
    When the simulation updates for 10 simulated seconds
    Then the aircraft turns right to intercept the centerline
    And the lateral deviation decreases toward zero
    And the aircraft stabilizes on an eastbound heading aligned with the course

  Scenario: Armed NAV does not steer the aircraft
    Given NAV mode is armed (orange button)
    And the aircraft is flying heading 090 at 100 knots
    And the VOR course is 20 degrees to the north (heading 070)
    When the simulation updates for 15 simulated seconds
    Then the aircraft remains on heading 090
    And no autopilot heading corrections are applied
    And the NAV button remains orange

  Scenario: NAV transitions from armed to active automatically
    Given NAV mode is armed (orange button)
    And the aircraft is 0.7 nautical miles from the VOR course
    And the aircraft is flying toward the course at 120 knots
    When the simulation runs and the aircraft reaches 0.4 nautical miles from the course
    Then the NAV button automatically changes from orange to green
    And the NAV mode status changes from "ARMED" to "ACTIVE"
    And the aircraft begins automatic course tracking
