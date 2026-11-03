# Designing questions and feedback

Write down what a successful response demonstrates. Solve the item independently before writing options. For open work, specify acceptable reasoning and an example of sufficient evidence. When explanation is the objective, collect an explanation orally, in writing or in an appropriate interaction, and tell the teacher how to assess it.

For each plausible distractor, record the reasoning it might reflect in teacher notes. Label its provenance as documented (identify the source), teacher_observed (identify the context) or hypothesized. A single selection can have several explanations. Ask a follow-up that distinguishes them. Use parallel choices and avoid grammatical clues. Delay hints and solutions until the desired independent response has been collected.

Try an intended answer, a legitimate variant and an incorrect response. In Blanks the list of textual alternatives is finite. For example, if 10 and 10.0 both satisfy the stated conversion criterion, test both. For general numeric tolerance, choose a suitable evaluator. Decide retry and solution availability explicitly. For QuestionSet, calculate the maximum of each child and the total. Partial MultiChoice scoring can give one item more influence than another.

## Worked example · density

The learner sees two labelled samples in [the editable source](../examples/density-source.json). A has 200 g in 100 cm³ and B has 400 g in 200 cm³. The single-choice point records the prediction before students see the density equation. Feedback on the correct choice defines density as mass divided by volume and works through both quotients in g/cm³. Feedback on each distractor asks the learner to reconsider the quantity they overlooked. After feedback, collect a spoken or written explanation. Look for the student to connect both doubling factors to the unchanged quotient.

- “Double” might reflect attention to mass alone (hypothesized). Ask what mass corresponds to one cm³ in each sample.
- “Half” might reflect attention to volume alone (hypothesized). Ask which other quantity changes.
- If explanations mention only mass, compare B with a third sample of 400 g in 100 cm³. If students explain the ratio, invite them to invent another pair with equal density and show how they know.

A teacher can use the explanation to choose the next task even when the prediction was correct. Keep these hypotheses in the teacher note. The exported question contains the learner's data, options and feedback.
