package com.finpess.app.ui.dashboard

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.finpess.app.core.Result
import com.finpess.app.core.SecurityManager
import com.finpess.app.data.model.DashboardDto
import com.finpess.app.data.repository.DashboardRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

sealed class DashboardUiState {
    object Loading : DashboardUiState()
    data class Success(val dashboard: DashboardDto) : DashboardUiState()
    data class Error(val message: String) : DashboardUiState()
}

class DashboardViewModel(
    private val dashboardRepository: DashboardRepository,
    private val securityManager: SecurityManager
) : ViewModel() {

    private val _uiState = MutableStateFlow<DashboardUiState>(DashboardUiState.Loading)
    val uiState: StateFlow<DashboardUiState> = _uiState.asStateFlow()

    private val _hideValues = MutableStateFlow(securityManager.isHideValues())
    val hideValues: StateFlow<Boolean> = _hideValues.asStateFlow()

    init {
        loadDashboard()
    }

    fun loadDashboard(mes: String = "") {
        viewModelScope.launch {
            _uiState.value = DashboardUiState.Loading
            when (val result = dashboardRepository.getDashboardData(mes)) {
                is Result.Success -> {
                    _uiState.value = DashboardUiState.Success(result.data)
                }
                is Result.Error -> {
                    _uiState.value = DashboardUiState.Error(result.message)
                }
                else -> Unit
            }
        }
    }

    fun toggleHideValues() {
        val newVal = !_hideValues.value
        _hideValues.value = newVal
        securityManager.setHideValues(newVal)
    }
}
