package com.finpess.app.ui.auth

import android.accounts.AccountManager
import android.app.Activity
import android.content.Intent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.finpess.app.R
import com.finpess.app.ui.theme.*

@Composable
fun LoginScreen(
    uiState: AuthUiState,
    onLoginClick: (email: String, pass: String) -> Unit,
    onGoogleLoginClick: (email: String, password: String?) -> Unit,
    onBiometricClick: () -> Unit,
    isBiometricAvailable: Boolean,
    modifier: Modifier = Modifier
) {
    var googleEmail by remember { mutableStateOf("") }
    var ownerPassword by remember { mutableStateOf("") }
    var passwordVisible by remember { mutableStateOf(false) }
    var showManualCredentials by remember { mutableStateOf(false) }
    val focusManager = LocalFocusManager.current

    // Launcher do Seletor Nativo de Contas Google do Android
    val accountChooserLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            val chosenEmail = result.data?.getStringExtra(AccountManager.KEY_ACCOUNT_NAME)
            if (!chosenEmail.isNullOrBlank()) {
                googleEmail = chosenEmail
                onGoogleLoginClick(chosenEmail, null)
            }
        }
    }

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(SlateBgDark)
            .padding(horizontal = 24.dp)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .align(Alignment.Center)
                .verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Spacer(modifier = Modifier.height(24.dp))

            // Logo Finpess
            Image(
                painter = painterResource(id = R.drawable.ic_finpess_logo),
                contentDescription = "Finpess Logo",
                modifier = Modifier
                    .size(80.dp)
                    .padding(bottom = 12.dp)
            )

            Text(
                text = "Finpess",
                style = MaterialTheme.typography.headlineLarge,
                color = Color.White,
                fontWeight = FontWeight.ExtraBold,
                letterSpacing = (-0.5).sp
            )

            Text(
                text = "Finanças Pessoais & Familiares",
                style = MaterialTheme.typography.bodyMedium,
                color = TextSecondaryDark,
                modifier = Modifier.padding(bottom = 28.dp)
            )

            // ESTADO: EXIGE SENHA DO PROPRIETÁRIO
            if (uiState is AuthUiState.RequireOwnerPassword) {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(16.dp),
                    colors = CardDefaults.cardColors(containerColor = SlateCardDark)
                ) {
                    Column(modifier = Modifier.padding(20.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(
                                imageVector = Icons.Default.Lock,
                                contentDescription = null,
                                tint = Color(0xFFF59E0B)
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(
                                text = "Conta de Proprietário",
                                color = Color.White,
                                fontWeight = FontWeight.Bold,
                                fontSize = 16.sp
                            )
                        }

                        Spacer(modifier = Modifier.height(8.dp))

                        Text(
                            text = "E-mail: ${uiState.email}",
                            color = EmeraldLight,
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 14.sp
                        )

                        Spacer(modifier = Modifier.height(4.dp))

                        Text(
                            text = uiState.message,
                            color = TextSecondaryDark,
                            fontSize = 12.sp,
                            lineHeight = 16.sp
                        )

                        Spacer(modifier = Modifier.height(16.dp))

                        OutlinedTextField(
                            value = ownerPassword,
                            onValueChange = { ownerPassword = it },
                            label = { Text("Senha do Proprietário") },
                            leadingIcon = {
                                Icon(Icons.Default.Lock, contentDescription = null, tint = EmeraldLight)
                            },
                            trailingIcon = {
                                IconButton(onClick = { passwordVisible = !passwordVisible }) {
                                    Icon(
                                        if (passwordVisible) Icons.Default.Visibility else Icons.Default.VisibilityOff,
                                        contentDescription = null,
                                        tint = TextSecondaryDark
                                    )
                                }
                            },
                            singleLine = true,
                            visualTransformation = if (passwordVisible) VisualTransformation.None else PasswordVisualTransformation(),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                            modifier = Modifier.fillMaxWidth()
                        )

                        Spacer(modifier = Modifier.height(16.dp))

                        Button(
                            onClick = {
                                focusManager.clearFocus()
                                onGoogleLoginClick(uiState.email, ownerPassword)
                            },
                            enabled = ownerPassword.isNotBlank(),
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(50.dp),
                            shape = RoundedCornerShape(12.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = EmeraldPrimary)
                        ) {
                            Text("Confirmar Acesso", fontWeight = FontWeight.Bold)
                        }
                    }
                }
            } else {
                // FLUXO NORMAL: LOGIN COM GOOGLE / GMAIL
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(20.dp),
                    colors = CardDefaults.cardColors(containerColor = SlateCardDark),
                    elevation = CardDefaults.cardElevation(defaultElevation = 6.dp)
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(20.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Text(
                            text = "Acesse com sua Conta Google",
                            color = Color.White,
                            fontWeight = FontWeight.Bold,
                            fontSize = 17.sp
                        )

                        Spacer(modifier = Modifier.height(6.dp))

                        Text(
                            text = "Conexão rápida com o Gmail cadastrado na sua planilha",
                            color = TextSecondaryDark,
                            fontSize = 12.sp,
                            textAlign = TextAlign.Center
                        )

                        Spacer(modifier = Modifier.height(20.dp))

                        // BOTÃO OFICIAL GOOGLE
                        Button(
                            onClick = {
                                try {
                                    val intent = AccountManager.newChooseAccountIntent(
                                        null,
                                        null,
                                        arrayOf("com.google"),
                                        null,
                                        null,
                                        null,
                                        null
                                    )
                                    accountChooserLauncher.launch(intent)
                                } catch (e: Exception) {
                                    // Se o seletor não puder ser aberto, permite digitar o e-mail abaixo
                                    if (googleEmail.isNotBlank()) {
                                        onGoogleLoginClick(googleEmail, null)
                                    }
                                }
                            },
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(52.dp),
                            shape = RoundedCornerShape(12.dp),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = Color.White,
                                contentColor = Color(0xFF1F2937)
                            ),
                            elevation = ButtonDefaults.buttonElevation(defaultElevation = 2.dp)
                        ) {
                            Image(
                                painter = painterResource(id = R.drawable.ic_google_logo),
                                contentDescription = "Google Logo",
                                modifier = Modifier.size(22.dp)
                            )
                            Spacer(modifier = Modifier.width(12.dp))
                            Text(
                                text = "Entrar com o Google / Gmail",
                                fontWeight = FontWeight.Bold,
                                fontSize = 15.sp,
                                color = Color(0xFF1F2937)
                            )
                        }

                        Spacer(modifier = Modifier.height(16.dp))

                        // Campo Alternativo para digitar o e-mail do Gmail diretamente
                        OutlinedTextField(
                            value = googleEmail,
                            onValueChange = { googleEmail = it },
                            label = { Text("Ou digite seu Gmail") },
                            placeholder = { Text("seu.email@gmail.com") },
                            leadingIcon = {
                                Icon(Icons.Default.Email, contentDescription = null, tint = EmeraldLight)
                            },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(
                                keyboardType = KeyboardType.Email,
                                imeAction = ImeAction.Done
                            ),
                            keyboardActions = KeyboardActions(
                                onDone = {
                                    focusManager.clearFocus()
                                    if (googleEmail.isNotBlank()) {
                                        onGoogleLoginClick(googleEmail, null)
                                    }
                                }
                            ),
                            modifier = Modifier.fillMaxWidth()
                        )

                        if (googleEmail.isNotBlank()) {
                            Spacer(modifier = Modifier.height(10.dp))
                            Button(
                                onClick = {
                                    focusManager.clearFocus()
                                    onGoogleLoginClick(googleEmail, null)
                                },
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(46.dp),
                                shape = RoundedCornerShape(10.dp),
                                colors = ButtonDefaults.buttonColors(containerColor = EmeraldPrimary)
                            ) {
                                Text("Acessar com este Gmail", fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(20.dp))

            // Atalho Biometria se disponível
            if (isBiometricAvailable) {
                OutlinedButton(
                    onClick = onBiometricClick,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(50.dp),
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = EmeraldLight)
                ) {
                    Icon(Icons.Default.Fingerprint, contentDescription = null, modifier = Modifier.size(20.dp))
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Entrar com Biometria", fontWeight = FontWeight.SemiBold)
                }
                Spacer(modifier = Modifier.height(16.dp))
            }

            // Exibição de Erro
            if (uiState is AuthUiState.Error) {
                Card(
                    colors = CardDefaults.cardColors(containerColor = Color(0x33EF4444)),
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 8.dp)
                ) {
                    Text(
                        text = uiState.message,
                        color = Color(0xFFF87171),
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.padding(12.dp),
                        textAlign = TextAlign.Center
                    )
                }
            }

            // Loading Indicator
            if (uiState is AuthUiState.Loading) {
                Spacer(modifier = Modifier.height(16.dp))
                CircularProgressIndicator(color = EmeraldLight)
            }

            Spacer(modifier = Modifier.height(32.dp))
        }
    }
}
