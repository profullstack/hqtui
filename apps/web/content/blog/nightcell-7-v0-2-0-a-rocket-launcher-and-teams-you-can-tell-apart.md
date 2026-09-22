---
title: "NIGHTCELL 7 v0.2.0: a rocket launcher, and teams you can tell apart"
date: "2026-09-22"
description: "<p>NIGHTCELL 7 v0.2.0 is out. It adds the M9 Hammerfall, a rocket launcher and the first weapon in the game that is not hitscan, and it fixes the thing that made the multiplayer yard hard to read:…"
canonical: "https://dev.profullstack.com/~anthony/blog/178-post.html"
author: Anthony Ettinger
---

<p>NIGHTCELL 7 v0.2.0 is out. It adds the M9 Hammerfall, a rocket launcher and the first weapon in the game that is not hitscan, and it fixes the thing that made the multiplayer yard hard to read: every fighter on both teams was the same shade of blue.</p>

<h2>Who this is for</h2>

<p>Anyone playing the free sandbox, in the browser or on the desktop client. Nothing here costs money. The launcher is bought with credits you earn in play.</p>

<h2>What changed</h2>

<ul>
<li><strong>The M9 Hammerfall.</strong> One rocket in the tube, five in reserve, and a 3.4 second reload. A direct hit does 65 damage on top of a blast that does 130 at the centre and reaches out to 7.5 metres. It is the only weapon whose shots you can see coming, lead, or duck behind cover from after they are fired. It flies at 42 metres a second, and its flight is worked out on the server like every other shot in the game, so two players watching one rocket see it land in the same place. Fire it at a wall in front of you and you take three quarters of the blast, which is deliberate.</li>
<li><strong>Original 3D art for it.</strong> The launcher is 3,044 triangles and the rocket is 1,612, both built by the same Blender generator as the rest of the yard. The asset sheet on the site now shows 29 models plus the approved rifle.</li>
<li><strong>Two teams, two colours.</strong> The code that paints each side's uniform only matched materials with certain names, and the current operator models use different ones, so it never ran and every fighter came out the same blue. Uniforms now take their team colour. The colour you pick on the deploy gate is the one your squad wears, and the enemy always wears whichever colour sits furthest from yours, so the two sides can never match.</li>
<li><strong>A desktop icon.</strong> The desktop client had no taskbar icon at all. It has one now, on Linux as well.</li>
</ul>

<h2>How to use it</h2>

<p>Open <a href="https://nightcell7.com/play">nightcell7.com/play</a>. You start with 1,000 credits and earn 100 per kill. The M9 costs 800 in the armory on the deploy gate, so you can buy it on your first deploy or save up for it after spending on something else. The desktop builds for macOS, Windows and Linux are at <a href="https://nightcell7.com/downloads">nightcell7.com/downloads</a>, and the install script picks up v0.2.0 on its own.</p>

<p><a href="https://github.com/profullstack/nightcell7/releases/tag/v0.2.0">https://github.com/profullstack/nightcell7/releases/tag/v0.2.0</a></p>
