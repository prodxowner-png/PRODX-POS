# Frontend Accessibility Checklist

Use this checklist during implementation and review. Mark items not applicable only with a short reason.

## Semantics and structure
- [ ] Page has a meaningful title and one clear primary heading.
- [ ] Landmarks and heading levels describe the page structure.
- [ ] Native buttons, links, inputs, and form controls are used where possible.
- [ ] Form controls have persistent visible labels and understandable validation messages.

## Keyboard and focus
- [ ] All interactive controls can be reached and operated using the keyboard.
- [ ] Focus order follows the visual and task order.
- [ ] Focus indicators are clearly visible in every theme.
- [ ] Dialogs, drawers, and menus manage focus on open, close, and dismissal.
- [ ] No keyboard traps; Escape works where expected.

## Names and announcements
- [ ] Icon-only controls have accessible names.
- [ ] Informative images have useful alt text; decorative images are ignored by assistive technology.
- [ ] Loading, success, error, and validation updates are announced when appropriate.
- [ ] Status is not conveyed by color alone.

## Visual accessibility
- [ ] Text contrast is at least 4.5:1 (3:1 for large text).
- [ ] Essential controls and graphical indicators have sufficient contrast.
- [ ] Text remains usable at zoom and on narrow viewports.
- [ ] Motion respects prefers-reduced-motion.

## Responsive and touch
- [ ] No unintended horizontal scrolling at 320px viewport width.
- [ ] Touch targets are comfortably operable and do not rely on hover.
- [ ] Responsive navigation and data tables remain usable on small screens.

## Evidence
- [ ] Keyboard pass completed.
- [ ] Automated accessibility scan run where available (for example axe).
- [ ] Any failures, exceptions, or unavailable checks are documented rather than silently waived.
