# Choosing a Typst package for a scientific figure

Start with what the student must read from the figure. Several subjects can use the same package, and one figure can combine packages.

| Student task | Package and entry point | Check in the rendered figure |
|---|---|---|
| Trace a force, compare directions, follow geometry or read a labelled drawing | `@preview/cetz:0.5.3`, `cetz.canvas` and `cetz.draw` | Anchor arrows to the body; scale lengths to magnitudes when the drawing claims a scale. |
| Read measured points, compare trends, plot a function or interpret a quantitative energy profile | `@preview/lilaq:0.6.0` as `lq`; use `lq.diagram` and `lq.plot` with numeric coordinates | Put units on axes. Preserve plateaus and missing observations. For activation energy compare the peak with the reactants; reaction progress is a schematic horizontal coordinate. |
| Read chemical formulas, stoichiometric coefficients, ionic charges, states or a reaction inside a diagram | `@preview/chemformula:0.1.3`, e.g. `ch("2 H2(g) + O2(g) -> 2 H2O(g)")` | Count atoms and total charge on each side. Separate coefficients, subscripts and superscripts. For a standalone H5P text equation, use the editable math route. |
| Compare molecular connectivity or draw a 2D structure from a known SMILES string | `@preview/typed-smiles:0.13.0`, e.g. `smiles("CCO")` | Keep the original SMILES. Check atom identities, implicit hydrogens, bond orders and any stereochemistry relevant to the question. A 2D layout does not establish a measured bond angle. |

A chemistry lesson about *energy versus reaction coordinate* uses Lilaq. A diagram showing molecules beside a balanced equation can combine typed-smiles and chemformula. Use CeTZ for additional geometry when spatial placement matters. For a task requiring every bond to hydrogen, inspect the drawing: the renderer can condense an O–H bond into an OH label.

The examples in `examples/scientific-figures/` exercise all four routes through the same source tool. The offline profile covers the features demonstrated there. Some Lilaq statistics, contours or random-data helpers lazily import additional packages; check availability before offering those features. The host installs the package closure at setup. An older CeTZ-only profile needs setup in a fresh directory before using these imports. Never fetch missing packages during rendering. Fletcher and Inknertia are candidates for specialized node diagrams and mechanics; neither is installed by this profile.
