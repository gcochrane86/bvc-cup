/** A fourball's two singles, [A player, B player] each: straight is A1 v B1 & A2 v B2, crossed is A1 v B2 & A2 v B1. */
export function singlesLineup(fb: { a: string[]; b: string[] }, crossed: boolean): [string, string][] {
  return [
    [fb.a[0], crossed ? fb.b[1] : fb.b[0]],
    [fb.a[1], crossed ? fb.b[0] : fb.b[1]],
  ];
}
