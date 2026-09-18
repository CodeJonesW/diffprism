---
title: Resize and hide the dashboard's panels
date: 2026-09-18
kind: feature
---

## What changed

You can now set the dashboard's layout the way you want it, and it stays that way:

- The sessions list, the file list and the threads panel can each be dragged to any size.
- Each one can be hidden to give the diff more room: the sessions list from its header, the file list from the button at the left of the diff's header, and the threads panel from its own header.
- A hidden panel leaves a way back on screen. The sessions list leaves a slim rail at the left edge, and hidden threads leave a bar at the bottom of the file list that shows how many there are.
- The layout survives a reload.

Keyboard shortcuts keep working with the file list hidden.

## Why

Every panel had a fixed size. On a big diff the sidebars took room the diff needed, and a busy thread list was capped at 40% of the sidebar with no way to give it more. The fixed layout had also caused two overlap bugs, in the sidebar and between the file list and the threads.

## Decisions

We used Mantine's `Splitter` rather than `react-resizable-panels`. The research pointed to the second, as the more established library that already remembers your layout. But we had used Mantine's splitter before and found it simpler to work with. Remembering the layout turned out to be a small addition to our store, so it wasn't a reason to pick the other one.

We brought in Mantine for the splitter alone, not its whole component library. Only the splitter's CSS and Mantine's CSS variables are loaded, not its full stylesheet. The full stylesheet includes a reset that would have restyled the page's font and background, which Tailwind already owns. We tried the smallest version on one panel first, checking in a browser that nothing else shifted, before rolling it out. It adds about 18 kB of JavaScript to the dashboard after compression.

Every panel you can hide has a way back that stays visible while it's hidden. A panel's own header disappears with it, so the way back can't live there.

## What we learned

Read the library's source as well as its docs. Two things our code depended on were missing from the docs or wrong there. The resize callback is `(handleIndex, sizes)`, not the `(sizes)` the docs show. And there's no option to start a panel hidden, so a hidden panel is restored after the page loads. Reading the source also showed that a hidden panel stays mounted, which meant the keyboard shortcuts didn't need moving out of the file list first.
