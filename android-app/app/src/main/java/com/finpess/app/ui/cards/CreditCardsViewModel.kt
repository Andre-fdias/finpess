package com.finpess.app.ui.cards

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.finpess.app.data.local.entity.CreditCardEntity
import com.finpess.app.data.repository.TransactionRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class CreditCardsUiState(
    val isLoading: Boolean = false,
    val errorMessage: String? = null
)

class CreditCardsViewModel(
    private val repository: TransactionRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(CreditCardsUiState())
    val uiState: StateFlow<CreditCardsUiState> = _uiState.asStateFlow()

    val creditCards: StateFlow<List<CreditCardEntity>> = repository.getLocalCreditCardsFlow()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, errorMessage = null)
            val res = repository.refreshAccountsAndCards()
            _uiState.value = _uiState.value.copy(
                isLoading = false,
                errorMessage = if (res is com.finpess.app.core.Result.Error) res.message else null
            )
        }
    }
}
