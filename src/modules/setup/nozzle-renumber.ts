/**
 * Puts nozzle renumbering into an order the database accepts. A pump cannot have two nozzles with
 * the same number at any moment, so swapping 1 and 2 (or rotating 1, 2, 3) cannot be sent as
 * plain one-by-one renames. A nozzle whose new number is still held by another nozzle that is
 * also changing waits its turn; when everything waits on each other (a swap or a rotation), one
 * nozzle is first moved to a temporary number that nobody uses.
 *
 * A nozzle whose new number is held by a nozzle that is not changing is sent as it is, so the
 * server refuses it with its normal "number already in use" message.
 */
export function planNozzleRenumbering(
  before: ReadonlyArray<{ id: string; number: string }>,
  wanted: ReadonlyArray<{ id: string; number: string }>,
): Array<{ id: string; number: string }> {
  const current = new Map(before.map((nozzle) => [nozzle.id, nozzle.number]));
  const pending = new Map(
    wanted
      .filter((nozzle) => current.has(nozzle.id) && current.get(nozzle.id) !== nozzle.number)
      .map((nozzle) => [nozzle.id, nozzle.number]),
  );
  const steps: Array<{ id: string; number: string }> = [];
  const used = () => new Set([...current.values(), ...pending.values()]);

  while (pending.size > 0) {
    const ready = [...pending].find(([id, target]) => {
      const holder = [...current].find(([otherId, number]) => otherId !== id && number === target);
      return !holder || !pending.has(holder[0]);
    });
    if (ready) {
      const [id, number] = ready;
      steps.push({ id, number });
      current.set(id, number);
      pending.delete(id);
      continue;
    }
    // Everything left waits on something else that is also changing: park one on a free number.
    const [parkedId] = [...pending][0]!;
    const taken = used();
    let index = 1;
    while (taken.has(`tmp${index}`)) index += 1;
    const parked = `tmp${index}`;
    steps.push({ id: parkedId, number: parked });
    current.set(parkedId, parked);
  }
  return steps;
}
