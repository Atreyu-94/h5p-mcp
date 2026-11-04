#import "@preview/cetz:0.5.3"
#set page(width: auto, height: auto, margin: 5pt)
#cetz.canvas({
  import cetz.draw: *
  line((0, 0), (2, 0))
  line((0, 2), (2, 2))
  line((1, 0), (1, 2), mark: (end: ">"))
  content((2.4, 0), [E1])
  content((2.4, 2), [E2])
})
