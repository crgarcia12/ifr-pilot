Feature: Extended velocity multipliers (16x and 32x)

  Background:
    Given the IFR Pilot game is loaded in the browser
    And a flight is in progress with the aircraft straight and level at 120 knots

  Scenario: Velocity control lists all six multipliers in order
    When I open the velocity control
    Then I see the options "1x", "2x", "4x", "8x", "16x", "32x" in that order

  Scenario: Selecting 16x activates the 16x rate
    When I click the "16x" button
    Then the "16x" button is shown as active
    And the simulation clock advances 16 simulated seconds for every 1 wall-clock second

  Scenario: Selecting 32x activates the 32x rate
    When I click the "32x" button
    Then the "32x" button is shown as active
    And the simulation clock advances 32 simulated seconds for every 1 wall-clock second

  Scenario: Distance covered at 16x matches 1x over equivalent simulated time
    Given the aircraft is at coordinates (47.45, -122.30) heading 090 at 120 knots ground speed
    When I select "16x" and wait 10 wall-clock seconds
    Then the distance traveled equals the 1x distance over 160 simulated seconds within 2 percent

  Scenario: Physics remain stable at 32x
    When I select "32x" and let the simulation run for 30 wall-clock seconds
    Then the aircraft latitude, longitude, altitude, heading, pitch, roll and airspeed are all finite numbers
    And no console errors are emitted

  Scenario: Selected multiplier persists across reload
    Given I have selected "32x"
    When I reload the page
    Then the velocity control opens with "32x" active

  Scenario: Keyboard cycling includes the new multipliers
    Given the current sim-rate is "8x"
    When I press the "increase sim-rate" key once
    Then the sim-rate becomes "16x"
    When I press the "increase sim-rate" key again
    Then the sim-rate becomes "32x"
