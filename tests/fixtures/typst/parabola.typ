#import "@preview/cetz:0.5.3"
#set page(width: auto, height: auto, margin: 5pt)
#cetz.canvas({
  import cetz.draw: *
  line((-1, 0), (1, 0))
  line((0, 0), (0, 1))
  line(..range(-10, 11).map(i => (i / 10, i * i / 100)), stroke: blue)
})
