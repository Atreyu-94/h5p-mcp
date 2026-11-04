#import "@preview/lilaq:0.6.0" as lq
#set page(width: auto, height: auto, margin: 7pt, fill: white)
#set text(size: 11pt, lang: "es")
#let seconds = (0, 2, 4, 6)
#let metres = (0, 4, 4, 2)
#lq.diagram(
  width: 6cm, height: 3.7cm,
  xlabel: [Tiempo (s)], ylabel: [Posición (m)],
  lq.plot(seconds, metres, mark: "o", stroke: navy),
)
