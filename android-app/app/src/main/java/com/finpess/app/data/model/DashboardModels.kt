package com.finpess.app.data.model

import com.google.gson.annotations.SerializedName

data class DashboardRequest(
    @SerializedName("action") val action: String = "dashboard.get",
    @SerializedName("payload") val payload: DashboardPayload = DashboardPayload(),
    @SerializedName("authContext") val authContext: AuthContextDto,
    @SerializedName("token") val token: String = "",
    @SerializedName("sessionToken") val sessionToken: String = ""
)

data class DashboardPayload(
    @SerializedName("mesReferencia") val mesReferencia: String = ""
)

data class DashboardDto(
    @SerializedName("mes_referencia") val mesReferencia: String,
    @SerializedName("data_referencia") val dataReferencia: String,
    @SerializedName("confirmados") val confirmados: ConfirmadosDto,
    @SerializedName("previstos") val previstos: PrevistosDto?,
    @SerializedName("pendentes") val pendentes: PendentesDto?,
    @SerializedName("estimados") val estimados: EstimadosDto?,
    @SerializedName("resumo_geral_modulos") val resumoModulos: ResumoGeralModulosDto?
)

data class ConfirmadosDto(
    @SerializedName("saldo_bancario_consolidado_centavos") val saldoBancarioCentavos: Long = 0,
    @SerializedName("receitas_realizadas_mes_centavos") val receitasMesCentavos: Long = 0,
    @SerializedName("despesas_pagas_mes_centavos") val despesasMesCentavos: Long = 0,
    @SerializedName("resultado_mensal_realizado_centavos") val resultadoMesCentavos: Long = 0
)

data class PrevistosDto(
    @SerializedName("receitas_previstas_mes_centavos") val receitasPrevistasCentavos: Long = 0,
    @SerializedName("despesas_previstas_mes_centavos") val despesasPrevistasCentavos: Long = 0
)

data class PendentesDto(
    @SerializedName("contas_vencidas_total_centavos") val contasVencidasCentavos: Long = 0,
    @SerializedName("contas_vencidas_quantidade") val contasVencidasQtd: Int = 0,
    @SerializedName("contas_a_vencer_total_centavos") val contasAVencerCentavos: Long = 0,
    @SerializedName("contas_a_vencer_quantidade") val contasAVencerQtd: Int = 0
)

data class EstimadosDto(
    @SerializedName("saldo_final_mes_projetado_centavos") val saldoFinalProjetadoCentavos: Long = 0
)

data class ResumoGeralModulosDto(
    @SerializedName("cartoes") val cartoes: ResumoCartoesDto?,
    @SerializedName("recorrentes") val recorrentes: ResumoRecorrentesDto?,
    @SerializedName("dividas") val dividas: ResumoDividasDto?,
    @SerializedName("emprestimos") val emprestimos: ResumoEmprestimosDto?,
    @SerializedName("investimentos") val investimentos: ResumoInvestimentosDto?,
    @SerializedName("metas") val metas: ResumoMetasDto?,
    @SerializedName("calendario") val calendario: ResumoCalendarioDto?,
    @SerializedName("bancos") val bancos: ResumoBancosDto?
)

data class ResumoCartoesDto(
    @SerializedName("total_cartoes") val totalCartoes: Int = 0,
    @SerializedName("faturas_abertas_centavos") val faturasAbertasCentavos: Long = 0,
    @SerializedName("limite_total_centavos") val limiteTotalCentavos: Long = 0,
    @SerializedName("limite_disponivel_centavos") val limiteDisponivelCentavos: Long = 0
)

data class ResumoRecorrentesDto(
    @SerializedName("total_ativas") val totalAtivas: Int = 0,
    @SerializedName("custo_fixo_mensal_centavos") val custoFixoMensalCentavos: Long = 0,
    @SerializedName("pagas_mes_centavos") val pagasMesCentavos: Long = 0,
    @SerializedName("pendentes_mes_centavos") val pendentesMesCentavos: Long = 0
)

data class ResumoDividasDto(
    @SerializedName("total_dividas") val totalDividas: Int = 0,
    @SerializedName("saldo_devedor_total_centavos") val saldoDevedorCentavos: Long = 0,
    @SerializedName("em_acordo_centavos") val emAcordoCentavos: Long = 0
)

data class ResumoEmprestimosDto(
    @SerializedName("total_emprestimos") val totalEmprestimos: Int = 0,
    @SerializedName("saldo_devedor_total_centavos") val saldoDevedorCentavos: Long = 0,
    @SerializedName("parcela_mensal_total_centavos") val parcelaMensalCentavos: Long = 0,
    @SerializedName("consignado_folha_centavos") val consignadoFolhaCentavos: Long = 0
)

data class ResumoInvestimentosDto(
    @SerializedName("patrimonio_total_centavos") val patrimonioTotalCentavos: Long = 0,
    @SerializedName("rentabilidade_total_centavos") val rentabilidadeCentavos: Long = 0,
    @SerializedName("rentabilidade_pct") val rentabilidadePct: Double = 0.0,
    @SerializedName("total_ativos") val totalAtivos: Int = 0
)

data class ResumoMetasDto(
    @SerializedName("total_metas") val totalMetas: Int = 0,
    @SerializedName("total_acumulado_centavos") val totalAcumuladoCentavos: Long = 0,
    @SerializedName("percentual_geral") val percentualGeral: Int = 0,
    @SerializedName("meses_reserva_cobertos") val mesesReservaCobertos: Double = 0.0
)

data class ResumoCalendarioDto(
    @SerializedName("total_pagar_mes_centavos") val totalPagarMesCentavos: Long = 0,
    @SerializedName("proximos_7_dias_centavos") val proximos7DiasCentavos: Long = 0,
    @SerializedName("contas_atrasadas_qtd") val contasAtrasadasQtd: Int = 0
)

data class ResumoBancosDto(
    @SerializedName("total_contas") val totalContas: Int = 0,
    @SerializedName("saldo_confirmado_centavos") val saldoConfirmadoCentavos: Long = 0,
    @SerializedName("saldo_projetado_centavos") val saldoProjetadoCentavos: Long = 0
)

