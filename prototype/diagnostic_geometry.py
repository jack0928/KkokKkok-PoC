"""Compare two geometric hypotheses on exactly the same matches. No location inference."""
import cv2
import numpy as np


def estimate(points0, points1, method, threshold):
    if method not in ('homography', 'fundamental') or threshold <= 0:
        raise ValueError('Invalid geometry settings')
    a, b = np.asarray(points0, np.float64).reshape(-1, 2), np.asarray(points1, np.float64).reshape(-1, 2)
    mask = np.zeros(len(a), dtype=bool)
    matrix = None
    if len(a) != len(b) or not np.isfinite(a).all() or not np.isfinite(b).all():
        raise ValueError("Invalid correspondences")
    minimum = 4 if method == 'homography' else 15  # OpenCV FM_RANSAC requires >=15.
    if len(a) >= minimum:
        cv2.setRNGSeed(42)
        try:
            if method == 'homography':
                matrix, found = cv2.findHomography(a, b, cv2.RANSAC, threshold, maxIters=2000, confidence=.995)
            elif method == 'fundamental':
                matrix, found = cv2.findFundamentalMat(a, b, cv2.FM_RANSAC, threshold, .995, 2000)
            else:
                raise ValueError("Unknown geometry method")
            if matrix is not None and matrix.shape == (3, 3) and np.isfinite(matrix).all() and np.linalg.matrix_rank(matrix) >= 2 and found is not None:
                mask = found.ravel().astype(bool)
            else:
                matrix = None
        except cv2.error:
            matrix = None
    residuals = [None] * len(a)
    if matrix is not None:
        x, y = np.column_stack((a, np.ones(len(a)))), np.column_stack((b, np.ones(len(b))))
        if method == 'homography':
            prediction = x @ matrix.T
            with np.errstate(divide='ignore', invalid='ignore'):
                errors = np.linalg.norm(prediction[:, :2] / prediction[:, 2:3] - b, axis=1)
        else:
            lines1, lines0 = x @ matrix.T, y @ matrix
            numerator = np.abs(np.sum(y * lines1, axis=1))
            with np.errstate(divide='ignore', invalid='ignore'):
                errors = np.maximum(numerator / np.linalg.norm(lines1[:, :2], axis=1),
                                    numerator / np.linalg.norm(lines0[:, :2], axis=1))
        residuals = [float(e) if np.isfinite(e) else None for e in errors]
    return {'method': method, 'thresholdPixels': threshold, 'matrix': matrix.tolist() if matrix is not None else None,
            'inlierMask': mask.tolist(), 'inliers': int(mask.sum()), 'residuals': residuals,
            'fitStatus': 'estimated' if matrix is not None else ('insufficient-points' if len(a) < minimum else 'estimation-failed'),
            'errorDefinition': 'forward reprojection in candidate pixels' if method == 'homography' else 'maximum of two point-to-epipolar-line distances in matching pixels'}


def compare_geometry(a, b, h_threshold=4., f_threshold=1.):
    h, f = estimate(a, b, 'homography', h_threshold), estimate(a, b, 'fundamental', f_threshold)
    hm, fm = np.array(h['inlierMask'], dtype=bool), np.array(f['inlierMask'], dtype=bool)
    categories = {'both': hm & fm, 'homography-only': hm & ~fm, 'fundamental-only': ~hm & fm, 'neither': ~hm & ~fm}
    # Diagnostic sampling across categories, not a population accuracy estimate.
    selected = []
    for values in categories.values():
        indices = np.flatnonzero(values)
        if len(indices):
            selected.append(int(indices[len(indices) // 2]))
    for index in np.linspace(0, max(0, len(a)-1), min(4, len(a)), dtype=int):
        if int(index) not in selected and len(selected) < 4:
            selected.append(int(index))
    return {'homography': h, 'fundamental': f, 'comparisonAvailable': h['fitStatus'] == f['fitStatus'] == 'estimated',
            'categories': {key: int(value.sum()) for key, value in categories.items()},
            'sampleIndices': selected,
            'sensitivity': {'homography': [estimate(a, b, 'homography', t) for t in (2., 4., 6.)],
                            'fundamental': [estimate(a, b, 'fundamental', t) for t in (.5, 1., 2.)]}}
