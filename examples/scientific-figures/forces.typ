#import "@preview/cetz:0.5.3" as cetz
#set page(width: auto, height: auto, margin: 7pt, fill: white)
#set text(size: 12pt, lang: "es")
#cetz.canvas({
  import cetz.draw: *
  for (dy, label) in ((1.7, [Tensión 8 N]), (-1.7, [Peso 8 N])) {
    line((0, 0), (0, dy), stroke: 1.3pt, mark: (end: ">"))
    content((0.3, dy * 0.65), label, anchor: "west")
  }
  circle((0, 0), radius: 0.10, fill: black)
})
