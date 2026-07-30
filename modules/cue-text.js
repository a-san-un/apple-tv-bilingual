// modules/cue-text.js

export function findCueAt(track, time) {
  if (!track) return null;

  let activeCues = null;
  try {
    activeCues = track.activeCues;
  } catch (_) {
    activeCues = null;
  }

  if (activeCues && activeCues.length > 0) {
    let bestActiveCue = null;
    let bestActiveScore = Infinity;

    for (let i = 0; i < activeCues.length; i++) {
      const cue = activeCues[i];
      if (!cue) continue;

      const center = (cue.startTime + cue.endTime) / 2;
      const score = Math.abs(center - time);

      if (score < bestActiveScore) {
        bestActiveScore = score;
        bestActiveCue = cue;
      }
    }

    if (bestActiveCue) return bestActiveCue;
  }

  let cues = null;
  try {
    cues = track.cues;
  } catch (_) {
    cues = null;
  }
  if (!cues) return null;

  let bestCue = null;
  let bestScore = Infinity;

  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    if (!cue) continue;

    const overlapsLoosely =
      cue.startTime <= time + 0.35 && time <= cue.endTime + 0.35;
    if (!overlapsLoosely) continue;

    const center = (cue.startTime + cue.endTime) / 2;
    const score = Math.abs(center - time);

    if (score < bestScore) {
      bestScore = score;
      bestCue = cue;
    }
  }

  return bestCue;
}

export function getCurrentCue(track, time) {
  if (!track) return null;

  try {
    const activeCue = track.activeCues?.[0] ?? null;
    if (activeCue) return activeCue;
  } catch (_) {
    return findCueAt(track, time);
  }

  return findCueAt(track, time);
}

export function getCurrentCueText(
  track,
  time,
  {
    getCurrentCueFn = getCurrentCue,
    cleanCueTextFn = (cue) => cue?.text ?? "",
  } = {}
) {
  return cleanCueTextFn(getCurrentCueFn(track, time));
}