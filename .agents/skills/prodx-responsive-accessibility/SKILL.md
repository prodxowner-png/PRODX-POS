---
name: prodx-responsive-accessibility
description: Verifies responsive behavior, keyboard and touch usability, semantic HTML, focus management, and accessibility of PRODX-POS interfaces.
---

# PRODX-POS Responsive Design & Accessibility

## Objective
Ensure POS and administration interfaces remain usable across supported mobile, tablet, desktop, keyboard, touch, and assistive-technology contexts.

## Responsive requirements
- Inspect the actual supported viewport targets and existing responsive conventions before changing breakpoints.
- Design around task priority and content hierarchy; do not simply scale desktop layouts down.
- Prevent horizontal overflow, clipped dialogs, inaccessible sticky regions, and controls hidden behind virtual keyboards.
- Ensure tables and dense data views have a usable narrow-screen strategy (responsive columns, detail views, or intentional horizontal scrolling with clear affordance).
- Keep critical POS actions and transaction totals visible at relevant cashier breakpoints.
- Respect reduced-motion preferences and avoid motion that blocks task completion.

## Accessibility requirements
- Use semantic landmarks, headings, buttons, links, labels, tables, and form controls.
- Every interactive control must have an accessible name and appropriate role/state.
- Support keyboard-only operation, logical tab order, visible focus, Escape behavior where appropriate, and focus restoration after dialogs.
- Associate validation and help text with controls; announce important async status/error changes accessibly.
- Do not communicate status or selection by color alone.
- Maintain sufficient text/control contrast, readable type, and touch target sizes.
- Avoid keyboard traps; dialogs and menus must manage focus correctly.
- Use alt text for meaningful images and empty alt text for decorative imagery.

## Verification procedure
1. Identify the supported viewport matrix from project docs/configuration; if none exists, propose and record a practical matrix without silently redefining product support.
2. Inspect each changed screen at narrow, medium, and wide supported widths.
3. Test keyboard navigation, focus visibility, forms, dialogs, menus, and error announcements.
4. Check zoom/reflow, overflow, text scaling, and reduced motion where tooling allows.
5. Run automated accessibility checks if already available; do not add a dependency without authorization.
6. Record manual checks separately from automated checks.

## Checklist
- [ ] No unintended overflow or clipped critical content.
- [ ] Critical cashier tasks work at supported viewport sizes.
- [ ] All interactive elements are keyboard reachable and operable.
- [ ] Focus is visible, logical, and correctly managed.
- [ ] Inputs, validation, and async messages have accessible names/announcements.
- [ ] Contrast and non-color status cues are adequate.
- [ ] Reduced motion and zoom/reflow behavior are respected.

## Evidence contract
Record viewport sizes/device emulation, keyboard scenarios, accessibility tooling and results, exact screens/files, and candidate SHA. Untested devices or assistive technologies must be marked UNVERIFIED.
