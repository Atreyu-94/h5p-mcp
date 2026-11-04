# Authoring scientific figures

Use these examples to exercise the same local `render_typst_figure` operation with different scientific questions. Supply the UTF-8 text of a document as `source` and the corresponding `alt` from `learner-es.json`. The examples use Typst 0.15.1 and the pinned offline scientific profile. The subject, drawing and level are up to the author.

| Source | What the teacher can verify |
|---|---|
| `forces.typ` | CeTZ draws the forces. Both arrows start at the body, point in opposite directions and use the same length scale for 8 N. |
| `motion.typ` | Lilaq plots the Physics 006-07 reference readings (0 s, 0 m), (2 s, 4 m), (4 s, 4 m) and (6 s, 2 m). The interval from 2 to 4 s is horizontal. |
| `reaction-energy.typ` | Lilaq plots the reaction coordinate. The forward barrier is 80 − 40 = 40 kJ/mol. The endpoint difference is 20 − 40 = −20 kJ/mol. The horizontal axis is a schematic reaction coordinate. |
| `water.typ` | typed-smiles draws the molecular structures and chemformula typesets the balanced gas-phase reaction. Two H–H molecules and one O=O molecule form two water molecules. There are four hydrogen and two oxygen atoms on each side. The drawing shows composition and bonding; lengths and angles are schematic. |

`learner-es.json` separates the visible caption, equivalent data or description, question, retry hint and post-answer explanation. Present the caption and equivalent information beside the question. When an equation itself is the task, use editable math with MathDisplay in the activity.

For a scored example, render `motion.typ`. Set `assets.grafica` in a copy of `motion-question.json` to the returned PNG path and run `h5p-mcp build motion-question.json motion.h5p` with the pinned H5P libraries available. The activity takes one answer. It keeps the four readings visible before the attempt and reveals the explanation after checking. The correct choice is the interval from 2 to 4 s.
