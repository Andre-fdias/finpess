package com.finpess.app.ui.transactions

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.finpess.app.core.Result
import com.finpess.app.data.local.entity.BankAccountEntity
import com.finpess.app.data.local.entity.LaunchEntity
import com.finpess.app.data.repository.TransactionRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

data class TransactionListUiState(
    val isLoading: Boolean = false,
    val selectedYearMonth: String = SimpleDateFormat("yyyy-MM", Locale.getDefault()).format(Date()),
    val searchQuery: String = "",
    val errorMessage: String? = null
)

class TransactionListViewModel(
    private val repository: TransactionRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(TransactionListUiState())
    val uiState: StateFlow<TransactionListUiState> = _uiState.asStateFlow()

    private val currentMonthFilter = MutableStateFlow(_uiState.value.selectedYearMonth)

    val bankAccounts: StateFlow<List<BankAccountEntity>> = repository.getLocalBankAccountsFlow()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    val launches: StateFlow<List<LaunchEntity>> = combine(
        currentMonthFilter.flatMapLatest { ym -> repository.getLocalLaunchesFlow(ym) },
        _uiState
    ) { list, state ->
        if (state.searchQuery.isBlank()) {
            list
        } else {
            val q = state.searchQuery.lowercase(Locale.getDefault())
            list.filter {
                it.descricao.lowercase(Locale.getDefault()).contains(q) ||
                it.categoria.lowercase(Locale.getDefault()).contains(q)
            }
        }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, errorMessage = null)
            val res = repository.refreshLaunches(_uiState.value.selectedYearMonth)
            repository.refreshAccountsAndCards()
            _uiState.value = _uiState.value.copy(
                isLoading = false,
                errorMessage = if (res is Result.Error) res.message else null
            )
        }
    }

    fun setSearchQuery(query: String) {
        _uiState.value = _uiState.value.copy(searchQuery = query)
    }

    fun nextMonth() {
        val cal = Calendar.getInstance()
        val parts = _uiState.value.selectedYearMonth.split("-")
        cal.set(Calendar.YEAR, parts[0].toInt())
        cal.set(Calendar.MONTH, parts[1].toInt() - 1)
        cal.add(Calendar.MONTH, 1)
        val nextYm = SimpleDateFormat("yyyy-MM", Locale.getDefault()).format(cal.time)
        setMonth(nextYm)
    }

    fun prevMonth() {
        val cal = Calendar.getInstance()
        val parts = _uiState.value.selectedYearMonth.split("-")
        cal.set(Calendar.YEAR, parts[0].toInt())
        cal.set(Calendar.MONTH, parts[1].toInt() - 1)
        cal.add(Calendar.MONTH, -1)
        val prevYm = SimpleDateFormat("yyyy-MM", Locale.getDefault()).format(cal.time)
        setMonth(prevYm)
    }

    private fun setMonth(ym: String) {
        _uiState.value = _uiState.value.copy(selectedYearMonth = ym)
        currentMonthFilter.value = ym
        refresh()
    }

    fun createTransaction(
        tipo: String,
        descricao: String,
        valorCentavos: Long,
        data: String,
        contaId: String,
        contaNome: String?,
        categoria: String,
        situacao: String,
        onSuccess: () -> Unit
    ) {
        viewModelScope.launch {
            repository.createLaunch(
                tipo = tipo,
                descricao = descricao,
                valorCentavos = valorCentavos,
                data = data,
                contaId = contaId,
                contaNome = contaNome,
                categoriaId = categoria,
                categoriaNome = categoria,
                situacao = situacao
            )
            onSuccess()
        }
    }
}
