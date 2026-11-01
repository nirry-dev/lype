// The town its place grows into: lots in blocks of two by two, with an avenue between the blocks, every third row and
// column counted from its card, which stands in the square where two avenues cross. Shared by where things are put
// (server/world.js) and how the ground under them is drawn (web/world.js).

export const BLOCK = 3;

/** Is this tile on an avenue (or the square its card stands on), rather than a lot? */
export const avenue = (x, y, card) => (x - card.x) % BLOCK === 0 || (y - card.y) % BLOCK === 0;
