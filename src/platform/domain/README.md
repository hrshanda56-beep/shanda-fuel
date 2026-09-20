# Shared domain primitives

This boundary contains small, dependency-light concepts shared by modules. It does not contain business aggregates or workflows. Money, litres, unit prices, and weighted-average costs use `decimal.js` through `ExactDecimal`; authoritative values must not be represented by JavaScript binary floating point.
