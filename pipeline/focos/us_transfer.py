"""Transparent ratio calibration; inputs must contain training months only."""
import numpy as np


def fit_ratios(x, target, calendar_month, method, train_states=None, shrink=200.):
    x = np.asarray(x)
    target = np.asarray(target)
    month = np.asarray(calendar_month)
    if x.shape != target.shape or x.shape[1] != len(month):
        raise ValueError('Shape mismatch')
    if not np.isfinite(x).all() or not np.isfinite(target).all() or (x < 0).any() or (target < 0).any():
        raise ValueError('Counts must be finite and nonnegative')
    mask = np.ones(x.shape[0], bool) if train_states is None else np.asarray(train_states, bool)
    den = x.sum(1) * mask
    num = target.sum(1) * mask
    if den.sum() <= 0:
        raise ValueError('No calibration support')
    g = num.sum() / den.sum()
    if method == 'unadjusted':
        return np.ones((len(x), 12))
    if method == 'national_ratio':
        return np.full((len(x), 12), g)
    sr = (num + shrink * g) / (den + shrink)
    if method == 'state_ratio':
        return np.repeat(sr[:, None], 12, axis=1)
    if method != 'state_season_ratio':
        raise ValueError('Unknown method')
    sf = np.empty((len(x), 12))
    for c in range(1, 13):
        ct = month == c
        cn = target[:, ct].sum(1) * mask
        cd = x[:, ct].sum(1) * mask
        sf[:, c - 1] = (cn + shrink * sr) / (cd + shrink)
    return sf
