# Tests

    cd test && npm i playwright        # once
    node engines.test.js               # puzzle generators, no browser
    node smoke.test.js                 # host → join → play → finish, over the relay
    node board.test.js                 # the scored pick-a-number board
    node show.test.js                  # the big screen: numbers, wheel, picture reveal
    QA_RUNTIME=python node smoke.test.js   # same, against server.py

`engines.test.js` loads `src/` directly in Node. The other two serve the built
`index.html` through `server.js` and drive real browsers, one isolated context
per person, so a host and its players are as separate as they are in a room.

Rebuild before running the browser suites: `node build.js`.
