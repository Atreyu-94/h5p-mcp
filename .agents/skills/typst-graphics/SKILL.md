---
name: typst-graphics
description: Author, revise and check editable scientific diagrams for local H5P questions from a teacher's brief. Use for a visual representation or data-reading task with the offline Typst renderer.
---

# Scientific graphics with Typst

Start from the inference the teacher wants the learner to make. Decide which observations must be available before answering and which interpretation belongs in feedback. Match notation, language and granularity to the audience. Mark any illustrative values as such. Preserve supplied observations, units, discontinuities and plateaus.

Choose marks that support the intended inference. Show discrete counts as points or steps according to what is known between observations. When the question asserts a continuous model, draw that model and distinguish the observed points; joining sparse samples with straight segments can misrepresent a parabola or dilution curve. Choose the package by the representation the student needs. Consult [Choosing a scientific package](references/packages.md) for CeTZ drawings, Lilaq plots, chemformula notation and typed-smiles structures, including cases that combine them. Ask for the missing data if inventing them would change the task. A schematic reaction coordinate needs a clear vertical energy reference; an arrow diagram needs a body, direction and scale; a molecule drawing needs a separate atom and bond count. Apply the equivalent domain check for a new subject. For editable equations in text consult h5p-authoring's mathematics guidance.

Call local `render_typst_figure` with the source and short alternative text. Review the actual PNG for clipping, label legibility and meaningful geometry. Supply the caption and visible data or a long description in the activity language. For a prediction, describe the observations in both modalities and reserve the conclusion for post-answer feedback. Write retry hints that point to the readings needed. When the teacher requests a graded activity use the h5p-authoring workflow to attach the PNG and verify scoring; preserve the SVG and source for future edits. The PNG asset and text resource expire. Keep the figure directory, or freeze a portable activity with its figure, for revisions after expiry.

The repository examples in `examples/scientific-figures/` include Spanish data, prompts and feedback. They exercise the source interface without restricting what can be drawn. At desktop, narrow width and true browser zoom check the size actually displayed by H5P, the adjacent text alternative and the keyboard path through an incorrect attempt, retry and correct feedback. Record separately what a real screen reader announced.
