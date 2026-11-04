#import "@preview/typed-smiles:0.13.0": smiles
#import "@preview/chemformula:0.1.3": ch
#set page(width: auto, height: auto, margin: 7pt, fill: white)
#set text(size: 12pt, lang: "es")
#align(center)[
  #grid(columns: (auto, auto, auto), align: center, gutter: 6pt,
    [Antes], [], [Después],
    [#smiles("[H][H]") #smiles("[H][H]")], [], [#smiles("[H]O[H]")],
    [#smiles("O=O")], [→], [#smiles("[H]O[H]")],
  )
  #v(4pt)
  #ch("2 H2(g) + O2(g) -> 2 H2O(g)")
]
