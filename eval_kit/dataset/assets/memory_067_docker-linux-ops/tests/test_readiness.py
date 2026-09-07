from app.readiness import DependencyState, aggregate

def test_aggregate_reports_unavailable_dependency():
    result = aggregate([DependencyState('db', False, 'timeout'), DependencyState('cache', True)])
    assert result['ready'] is False
    assert result['dependencies']['db']['detail'] == 'timeout'
