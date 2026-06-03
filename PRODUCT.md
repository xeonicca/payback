# Product

## Register

product

## Users

Friends on group trips — casual groups of 2-8 people splitting costs for restaurants, transport, accommodation, and activities while traveling together. Primary usage is on mobile, mid-trip, often between activities. Taiwanese audience with Traditional Chinese UI; multi-currency trips are common (e.g., Taiwan → Japan). Users are not finance-minded; they just want to settle who owes what quickly and fairly.

## Product Purpose

A PWA for tracking and splitting expenses during travel. Users log expenses, the app calculates who owes whom, and the group settles up at the end of the trip. Success means: zero friction to add an expense, clear settlement view at the end, and no arguments over who paid what.

## Brand Personality

Clean, efficient, reliable. Three words: precise, calm, fast. Emotional goal: confidence that the numbers are right, without feeling like you're doing accounting.

## Anti-references

Overly decorative or gamified finance apps. Apps that prioritize visual flair over speed of entry. Anything that adds friction to the two-tap expense log. Heavy onboarding flows. Dashboard-style metric heroes with big numbers and gradient accents.

## Design Principles

1. **Speed over spectacle.** The user is mid-trip, standing somewhere. Two taps to log an expense. Settings changes should be one screen in, one tap out.
2. **Clarity through hierarchy.** Amounts are the most important information. Use size, weight, and monospace to make numbers scannable. Secondary info (dates, members) stays small and muted.
3. **Quiet confidence.** The interface should feel reliable without being loud. Subtle shadows, smooth transitions, restrained color usage. No gratuitous decoration.
4. **Mobile-first, touch-friendly.** Bottom navigation, large tap targets (44px+), thumb-reachable primary actions. Desktop is a nice-to-have.
5. **Collaborative but not noisy.** Show who's involved without making collaboration the centerpiece — the expenses are what matter.

## Accessibility & Inclusion

WCAG AA minimum. Support system dark mode via CSS variables. Touch targets 44px+. All form fields labeled. Traditional Chinese text must render cleanly (Noto Sans TC Light for CJK).
