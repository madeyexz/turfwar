"""The measures that recorded humans, recorded bots, sim bots and the prototype all run (same row format)."""
import numpy as np
from ds import A, E, M, OWN, SLOT, AUTO, wrap


def runs_of(rows):
    """Run id per row (a run = consecutive rows of one soldier without a gap) and the time inside the data (cumulative dt)."""
    dt = rows[:, A['dt']].astype(np.float64)
    brk = (dt <= 0) | (dt > 0.25)
    run = np.cumsum(brk) - 1
    tc = np.cumsum(np.where(brk, 0.0, dt)) + run * 10.0  # 10 s between runs so time windows never span two runs
    return run, tc, brk


def qs(x, ps=(10, 25, 50, 75, 90)):
    x = np.asarray(x, dtype=np.float64)
    return [round(float(v), 4) for v in np.percentile(x, ps)] if x.size else []


def onsets(rows, run, tc, quiet=0.5):
    """Rows where an enemy comes into sight after `quiet` seconds without any (inside one run, not at its first half second)."""
    n = len(rows)
    vis = rows[:, A['nvis']] > 0
    idx = np.arange(n)
    last = np.maximum.accumulate(np.where(vis, idx, -1))
    prev = np.concatenate([[-1], last[:-1]])
    first_of_run = np.concatenate([[0], np.flatnonzero(np.diff(run)) + 1])
    run_start = first_of_run[run]
    same = prev >= run_start
    since = np.where(same, tc - tc[np.maximum(prev, 0)], tc - tc[run_start])
    return np.flatnonzero(vis & (since >= quiet) & (idx > run_start))


def windows(on, run, n, W):
    """Row indices [onset, onset + W) per onset, and a mask of the rows still in the onset's run."""
    ix = on[:, None] + np.arange(W)[None, :]
    ok = ix < n
    ix = np.minimum(ix, n - 1)
    ok &= run[ix] == run[on][:, None]
    return ix, ok


def first_true(mask):
    """Index of the first True per row, -1 when none."""
    any_ = mask.any(1)
    return np.where(any_, mask.argmax(1), -1)


def aim_metrics(rows, with_recoil=True):
    out = {}
    n = len(rows)
    run, tc, brk = runs_of(rows)
    dt = np.where(brk, np.nan, rows[:, A['dt']].astype(np.float64))
    hours = float(np.nansum(dt)) / 3600
    out['hours'] = round(hours, 3)
    e0 = rows[:, OWN:OWN + SLOT]
    vis0 = e0[:, E['vis']] > 0
    anyvis = rows[:, A['nvis']] > 0
    shots, hits, heads = rows[:, A['shots']], rows[:, A['hits']], rows[:, A['heads']]
    w = rows[:, A['weapon']].astype(int)
    gun = (w != 0)
    speed = np.hypot(rows[:, A['mdyaw']], rows[:, A['mdpitch']]) / dt  # rad/s of the own aim change
    ok = ~brk
    out['vis_share'] = round(float(anyvis.mean()), 4)
    out['shots_per_min'] = round(float(shots.sum()) / (hours * 60), 2)
    out['hit_rate'] = round(float(hits[gun].sum() / max(1, shots[gun].sum())), 4)
    out['head_share_of_hits'] = round(float(heads[gun].sum() / max(1, hits[gun].sum())), 4)
    out['shots_no_enemy_in_sight'] = round(float(shots[gun & ~anyvis].sum() / max(1, shots[gun].sum())), 4)
    # ---- kinematics
    out['turn_speed_no_enemy'] = qs(speed[ok & ~anyvis])
    out['turn_speed_enemy'] = qs(speed[ok & anyvis])
    out['still_share_no_enemy'] = round(float((speed[ok & ~anyvis] < 0.02).mean()), 4)
    out['still_share_enemy'] = round(float((speed[ok & anyvis] < 0.02).mean()), 4)
    out['turn_speed_p99'] = round(float(np.nanpercentile(speed[ok], 99)), 3)
    out['turn_speed_p999'] = round(float(np.nanpercentile(speed[ok], 99.9)), 3)
    # ---- first sight episodes (3 s)
    on = onsets(rows, run, tc)
    W = 100
    ix, okw = windows(on, run, n, W)
    t = tc[ix] - tc[on][:, None]
    okw &= t <= 3.0
    tid = e0[on, E['id']]
    same = okw & (e0[ix, E['id']] == tid[:, None])  # the first target is still slot 0
    ey0, ep0, d0 = e0[on, E['eyaw']], e0[on, E['epc']], e0[on, E['dist']]
    off0 = np.hypot(ey0, ep0)
    infov = (np.abs(ey0) < 0.75) & (np.abs(ep0) < 0.45)  # on screen at 78 degrees
    out['onsets'] = int(len(on)); out['onsets_on_screen'] = int(infov.sum())
    out['onsets_per_hour'] = round(len(on) / hours, 1)
    out['first_offset_rad'] = qs(off0[infov])
    # time to first shot at this sight (the target stays visible until then)
    visw = e0[ix, E['vis']] > 0
    shot_w = (shots[ix] > 0) & okw
    k = first_true(shot_w)
    has = (k >= 0) & infov & gun[on]
    # lost before the shot? count only when the enemy was in sight for at least 80 % of the rows before the shot
    kk = np.maximum(k, 1)
    cs = np.cumsum(visw & same, 1)
    seen_frac = cs[np.arange(len(on)), kk - 1] / kk
    has &= seen_frac > 0.8
    rt = t[np.arange(len(on)), np.maximum(k, 0)]
    out['time_to_first_shot'] = qs(rt[has]); out['time_to_first_shot_n'] = int(has.sum())
    out['shot_within_3s_share'] = round(float(has.sum() / max(1, (infov & gun[on]).sum())), 4)
    # time to get on target: error under max(0.03 rad, 0.35 m / distance), for first offsets over 0.12 rad
    err = np.hypot(e0[ix, E['eyaw']], e0[ix, E['epc']])
    tol = np.maximum(0.03, 0.35 / np.maximum(d0, 1.0))
    big = infov & (off0 > 0.12) & (off0 < 0.8)
    k2 = first_true(same & visw & (err < tol[:, None]))
    has2 = big & (k2 >= 0)
    out['time_to_on_target'] = qs(t[np.arange(len(on)), np.maximum(k2, 0)][has2]); out['time_to_on_target_n'] = int(has2.sum())
    out['on_target_within_3s_share'] = round(float(has2.sum() / max(1, big.sum())), 4)
    # time to the first clear aim move toward the target: error down by 25 % of the first offset
    k3 = first_true(same & (err < 0.75 * off0[:, None]))
    has3 = big & (k3 >= 1)
    out['time_to_first_correction'] = qs(t[np.arange(len(on)), np.maximum(k3, 0)][has3]); out['time_to_first_correction_n'] = int(has3.sum())
    # peak turn speed in the first second against the first offset (the main sequence of flicks)
    sp = np.where(okw & (t <= 1.0), np.nan_to_num(speed[ix]), 0.0)
    peak = sp.max(1)
    for lo, hi in ((0.05, 0.12), (0.12, 0.3), (0.3, 0.75)):
        m = infov & (off0 >= lo) & (off0 < hi)
        out[f'peak_speed_off_{lo}_{hi}'] = qs(peak[m], (25, 50, 75, 95))
    # ---- error at the shots (slot 0 in sight)
    sh = (shots > 0) & vis0 & gun
    dist = e0[:, E['dist']]
    lat = np.abs(np.sin(e0[:, E['eyaw']])) * dist
    out['shot_lateral_error_m'] = qs(lat[sh]); out['shot_vertical_chest_m'] = qs((e0[:, E['epc']] * dist)[sh])
    out['shots_within_0.3m_lateral'] = round(float((lat[sh] < 0.3).mean()), 4) if sh.any() else 0
    for lo, hi in ((0, 8), (8, 15), (15, 30), (30, 200)):
        m = (shots > 0) & gun & (e0[:, E['id']] >= 0) & (dist >= lo) & (dist < hi)
        out[f'hit_rate_{lo}_{hi}m'] = [round(float(hits[m].sum() / max(1, shots[m].sum())), 4), int(shots[m].sum())]
    # ---- bursts of the automatic weapons (a gap of 0.25 s ends a burst)
    si = np.flatnonzero((shots > 0) & AUTO[w])
    if len(si) > 10:
        newb = np.concatenate([[True], (np.diff(tc[si]) > 0.25) | (np.diff(run[si]) != 0)])
        bid = np.cumsum(newb) - 1
        blen = np.bincount(bid, weights=shots[si])
        out['burst_shots'] = qs(blen); out['burst_mean'] = round(float(blen.mean()), 2); out['burst_1_share'] = round(float((blen <= 1).mean()), 4); out['bursts'] = int(len(blen))
        gaps = np.diff(tc[si])[(~newb[1:])]
        first = si[newb]; last = si[np.concatenate([newb[1:], [True]])]
        dur = tc[last] - tc[first]
        out['burst_seconds'] = qs(dur)
        pause = (tc[first][1:] - tc[last][:-1])[run[first][1:] == run[last][:-1]]
        out['pause_between_bursts'] = qs(pause[pause < 3])
        if with_recoil:
            # recoil = total pitch change less the mouse part; compensation = mouse pitch change during the burst
            dp = np.concatenate([[0], np.diff(rows[:, A['pitch']])]); dp[brk] = 0
            rec = dp - rows[:, A['mdpitch']]; rec[brk] = 0
            crec = np.cumsum(rec); cm = np.cumsum(rows[:, A['mdpitch']].astype(np.float64)); cmy = np.cumsum(rows[:, A['mdyaw']].astype(np.float64))
            long_ = blen >= 5
            kick = crec[last] - crec[first - 1]; pull = -(cm[last] - cm[first - 1])
            good = long_ & (kick > 0.01)
            out['recoil_kick_per_long_burst_rad'] = qs(kick[good]); out['recoil_comp_ratio'] = qs((pull / np.where(kick > 0, kick, 1))[good]); out['long_bursts'] = int(good.sum())
            out['mouse_pitch_in_long_burst_rad'] = qs((cm[last] - cm[first - 1])[long_])
    # ---- the fire key and the target
    out['fire_rows_share'] = round(float((rows[:, A['fire']] > 0).mean()), 4)
    out['ads_share_enemy'] = round(float(rows[anyvis, A['ads']].mean()), 4)
    out['crouch_share_enemy'] = round(float((rows[anyvis, A['crouch']] > 0.5).mean()), 4)
    out['strafe_share_enemy'] = round(float((np.abs(rows[anyvis, A['vs']]) > 1.5).mean()), 4)
    out['still_body_share_enemy'] = round(float((rows[anyvis, A['speed']] < 0.5).mean()), 4)
    return out


def move_metrics(rows):
    out = {}
    dt = rows[:, M['dt']].astype(np.float64)
    brk = (dt <= 0) | (dt > 0.35)
    run = np.cumsum(brk) - 1
    n = len(rows)
    out['hours'] = round(n / 36000, 2)
    fl = rows[:, M['flags']].astype(int)
    sp = np.hypot(rows[:, M['vf']], rows[:, M['vs']])
    vis = rows[:, M['nVisible']] > 0
    out['speed'] = qs(sp)
    out['still_share'] = round(float((sp < 0.5).mean()), 4)
    out['sprint_share'] = round(float(((fl & 4) > 0).mean()), 4)
    out['air_share'] = round(float(((fl & 2) == 0).mean()), 4)
    out['slide_share'] = round(float(((fl & 16) > 0).mean()), 4)
    out['ads_share'] = round(float(((fl & 8) > 0).mean()), 4)
    out['enemy_in_sight_share'] = round(float(vis.mean()), 4)
    out['still_share_enemy'] = round(float((sp[vis] < 0.5).mean()), 4)
    out['sideways_share_enemy'] = round(float((np.abs(rows[vis, M['vs']]) > np.abs(rows[vis, M['vf']])).mean()), 4)
    out['backward_share'] = round(float((rows[:, M['vf']] < -1).mean()), 4)
    # strafe flips while an enemy is in sight: sign changes of the side speed per second
    vs = rows[:, M['vs']]
    s = np.sign(np.where(np.abs(vs) > 1.0, vs, 0))
    flip = (s[1:] * s[:-1] < 0) & ~brk[1:] & vis[1:]
    out['strafe_flips_per_s_enemy'] = round(float(flip.sum() / max(1, vis.sum()) * 10), 4)
    # turn rate of the body yaw
    dy = np.abs(wrap(np.diff(rows[:, M['yaw']]))) / np.where(brk[1:], np.nan, dt[1:])
    out['yaw_rate'] = qs(dy[~np.isnan(dy)])
    # straightness: net distance over path length in 5 s windows
    x, z = rows[:, M['x']].astype(np.float64), rows[:, M['z']].astype(np.float64)
    K = 50
    if n > K + 1:
        step = np.hypot(np.diff(x), np.diff(z)); step[brk[1:]] = 0
        cs = np.concatenate([[0], np.cumsum(step)])
        i = np.arange(0, n - K, 10)
        okk = run[i] == run[i + K]
        path = cs[i + K] - cs[i]; net = np.hypot(x[i + K] - x[i], z[i + K] - z[i])
        m = okk & (path > 8)
        out['straightness_5s'] = qs((net / np.maximum(path, 1e-6))[m])
        out['path_5s_m'] = qs(path[okk])
    out['nearest_ally_m'] = qs(rows[rows[:, M['ntDist']] >= 0, M['ntDist']])
    out['nearest_enemy_seen_m'] = qs(rows[rows[:, M['nvDist']] >= 0, M['nvDist']])
    out['wall_ahead_m'] = qs(rows[:, M['rays']]); out['wall_min_m'] = qs(rows[:, M['rays']:M['rays'] + 8].min(1))
    out['hurt_per_min'] = round(float(rows[:, M['hurt']].sum()) / (n / 600), 2)
    return out
