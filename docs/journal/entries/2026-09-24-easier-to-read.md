---
title: Easier to read, measured against GitHub
date: 2026-09-24
kind: fix
---

## What changed

The review UI is easier to read in both themes. Secondary text, line numbers, code comments and the purple accent are brighter in dark mode. Light mode sits on a near-white background instead of a grey-blue one, and its syntax colors are darker. The smallest labels went up a step, from 10px to 11px and from 11px to 12px.

## Why

Reading a diff in DiffPrism was harder than reading the same diff on GitHub. Measured, the gap was contrast. In dark mode, comments were 3.8:1 against the background, below the 4.5:1 WCAG minimum for body text; GitHub's are 6.5:1. Secondary text was 5.1:1 against GitHub's 6.5:1. In light mode, five of the eight syntax colors fell under 4.5:1 on the side panels, one as low as 3.0:1.

## Decisions

**Match GitHub's contrast, not its colors.** We kept DiffPrism's hues, including the purple, and only moved each color's lightness until it reached GitHub's contrast: about 16:1 for body text, 6.3:1 for secondary text, 5.8:1 for comments, and at least 5:1 for every syntax color in light mode. Dark-mode syntax colors were already above 7:1, so they stayed as they were.

**Measured on the darker panel.** Every target was checked against the surface color the side panels use, not just the page background, because the surface is where most secondary text sits and it is the harder case.

## What we learned

"Harder to read" was a number all along. Computing the contrast ratio of each color pair against the reference you're comparing to turns a taste argument into a list of colors to fix.
