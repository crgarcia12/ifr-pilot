# NAV Mode Oscillation Fix

## Problem
The NAV autopilot mode exhibited unstable side-to-side oscillation when intercepting VOR radials. The aircraft would overshoot the course centerline repeatedly, creating a zig-zag pattern instead of smoothly converging on the desired radial.

## Root Cause
The original implementation used a simple proportional controller based only on CDI deflection:
```javascript
const intercept = clamp(cdi * 30, -45, 45);
```

This approach:
- Had no awareness of closure rate (how fast the aircraft was approaching the course)
- Provided constant gain regardless of distance from centerline
- Lacked damping to prevent overshoot
- Reacted only after crossing the course line

## Solution
Implemented a Proportional-Derivative (PD) controller with the following improvements:

### 1. Cross-Track Distance Calculation
Calculate actual perpendicular distance to the course line in nautical miles:
```javascript
const crossTrackNm = dist * Math.sin(Math.abs(dev) * Math.PI / 180);
```

### 2. Proportional Control
Intercept angle proportional to cross-track error:
```javascript
const K_p = 15; // degrees per NM off course
const proportional = crossTrackNm * K_p * crossTrackSign;
```

### 3. Derivative Damping
Apply damping based on heading convergence to prevent overshoot:
```javascript
const K_d = 2; // damping factor
const headingToCourse = angleDiff(state.hdg, VOR.courseOBS);
const derivative = headingToCourse * K_d;
intercept = clamp(proportional - derivative, -45, 45);
```

### 4. Deadband Near Centerline
Reduce gain by 50% when very close to prevent hunting:
```javascript
if (Math.abs(crossTrackNm) < 0.05) {
  intercept *= 0.5;
}
```

## Test Coverage
Added comprehensive unit tests in `tests/nav-autopilot.test.js`:
- ✅ Proportional control based on cross-track distance
- ✅ Reduced correction as aircraft approaches centerline
- ✅ Damping when heading is already converging
- ✅ Stable behavior without wild divergence
- ✅ Course maintenance without hunting

## Result
The NAV autopilot now:
- Smoothly intercepts VOR radials without oscillation
- Uses larger intercept angles when far from course, smaller when near
- Anticipates convergence and reduces corrections appropriately
- Maintains stable heading once established on course
- Behaves realistically per IFR flight procedures
