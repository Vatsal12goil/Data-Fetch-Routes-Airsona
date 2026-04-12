document.getElementById('search-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const cityInput = document.getElementById('city-input').value;
    const btnText = document.querySelector('#search-btn span');
    const loader = document.getElementById('btn-loader');
    const resultsContainer = document.getElementById('results-container');
    
    if (!cityInput) return;

    // Loading state
    btnText.classList.add('hidden');
    loader.classList.add('active');
    resultsContainer.classList.add('hidden');

    try {
        const response = await fetch('/api/location-recommendations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ city: cityInput })
        });
        
        const json = await response.json();
        
        if (!json.success) {
            alert("Error: " + (json.error || "Could not fetch data for this location"));
            return;
        }

        renderResults(json.data);
        resultsContainer.classList.remove('hidden');
    } catch (error) {
        alert("Network error: Could not reach the engine API.");
        console.error(error);
    } finally {
        btnText.classList.remove('hidden');
        loader.classList.remove('active');
    }
});

function getScoreClass(score) {
    if (score >= 75) return 'score-excellent';
    if (score >= 55) return 'score-high';
    if (score >= 35) return 'score-moderate';
    return 'score-low';
}

function renderResults(data) {
    // Top-level Profile
    document.getElementById('res-location').textContent = `${data.location.city}, ${data.location.country}`;
    
    const riskBadge = document.getElementById('res-risk');
    riskBadge.textContent = `Overall Risk: ${data.profile_summary.overall_environmental_risk}/100`;
    riskBadge.style.backgroundColor = data.profile_summary.overall_environmental_risk > 70 ? 'rgba(239, 68, 68, 0.2)' : 'rgba(52, 211, 153, 0.2)';
    riskBadge.style.color = data.profile_summary.overall_environmental_risk > 70 ? '#f87171' : '#34d399';

    document.getElementById('stat-solar').textContent = data.profile_summary.solar_potential;
    document.getElementById('stat-wind').textContent = data.profile_summary.wind_potential;
    document.getElementById('stat-pollution').textContent = data.profile_summary.pollution_severity;
    document.getElementById('stat-density').textContent = data.profile_summary.urbanization;

    // Insights
    const insightsGrid = document.getElementById('insights-grid');
    insightsGrid.innerHTML = '';
    data.insights.forEach(insight => {
        let borderCol = insight.type === 'warning' ? '#f87171' : insight.type === 'opportunity' ? '#fbbf24' : '#60a5fa';
        insightsGrid.innerHTML += `
            <div class="insight-card" style="border-left-color: ${borderCol}">
                <span class="insight-type" style="color: ${borderCol}">${insight.type}</span>
                <h4>${insight.title}</h4>
                <p>${insight.body}</p>
                <div class="insight-data">${insight.supporting_data}</div>
            </div>
        `;
    });

    // Recommendations
    const recList = document.getElementById('rec-list');
    recList.innerHTML = '';
    
    // Render top 5
    data.topRecommendations.slice(0, 5).forEach(rec => {
        const scoreClass = getScoreClass(rec.score);
        recList.innerHTML += `
            <div class="rec-card">
                <div class="rec-score-circle ${scoreClass}">${rec.score}</div>
                <div class="rec-details">
                    <div class="rec-header">
                        <h4 class="rec-title">${rec.solution}</h4>
                    </div>
                    <div class="rec-metrics">
                        <span>Impact: <strong>${rec.timeToImpact}</strong></span>
                        <span>Difficulty: <strong>${rec.implementationDifficulty}</strong></span>
                        <span>Confidence: <strong>${rec.confidence}%</strong></span>
                    </div>
                    <p class="rec-reason">${rec.reason}</p>
                </div>
            </div>
        `;
    });
}
