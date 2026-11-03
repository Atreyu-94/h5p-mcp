#import "@preview/lilaq:0.6.0" as lq
#set page(width: auto, height: auto, margin: 7pt, fill: white)
#set text(size: 11pt, lang: "es")
#lq.diagram(
  width: 6cm, height: 3.7cm, ylim: (0, 90),
  xlabel: [Avance de la reacción], ylabel: [Energía relativa (kJ/mol)],
  xaxis: (ticks: none, subticks: none),
  lq.plot((0, 1, 2, 3, 4), (40, 40, 80, 20, 20), mark: none, stroke: navy),
)
