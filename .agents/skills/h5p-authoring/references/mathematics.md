# Choosing and writing mathematical notation

Decide what the student should be able to do before placing a formula. If the task is to apply a given relationship, put it beside the data and define the symbols and units. For example, “Use `\(v=d/t\)`, where `\(d\)` is distance in metres and `\(t\)` is time in seconds. A runner covers 60 m in 12 s. What is the average speed in m/s?” The expected value is 5. For a numerical blank, place the unit next to the input and include the written variants the task accepts.

If the task is to discover a relationship or predict an outcome independently, give the observations first. After the response, use an equation to connect the student's choice to the evidence. The [density example](../examples/density-source.json) uses the two samples this way. A prompt asking students to recognise the unit of length needs only the unit names. Quantities such as 60 m and 2 g/cm³ read well in ordinary text.

## Entering a formula

Use editable LaTeX in a text field for fractions, powers and other notation whose structure matters. Use `\(...\)` within a sentence. For a standalone calculation use `\[...\]` or `$$...$$`. Keep both delimiters in the same text field. A single pair of dollar signs is outside the documented H5P forms.

In an editor the inline expression is `\(v=\frac{d}{t}\)`. In a JSON source, double each backslash, including those in the delimiters and commands.

~~~json
{"format":"plain","value":"Use \\(v=\\frac{d}{t}\\), where d is distance in metres and t is time in seconds."}
~~~

A display equation in feedback could read as follows.

~~~tex
\[v=\frac{60\,\mathrm{m}}{12\,\mathrm{s}}=5\,\mathrm{m/s}\]
~~~

Keep a formula as editable text so the teacher can revise the symbols and units. Pair it with the words a student needs to interpret it. For Blanks, use a plain answer key and check its accepted alternatives. When the objective is to recognise equivalent expressions, a choice among rendered expressions can collect that evidence. MathDisplay renders the choices. The activity's answer key determines the score.

Preparation requires the installed MathDisplay addon when it detects LaTeX. The destination must provide or permit the required library. Check the expression in the initial prompt or option and again when feedback opens after a response. Inspect the rendered symbols, units and score in the target activity. [H5P mathematical expressions](https://h5p.org/mathematical-expressions)
