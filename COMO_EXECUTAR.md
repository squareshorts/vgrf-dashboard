# Guia de Execução do Painel vGRF
## Monitoramento de Força de Reação ao Solo (GRF) Multi-Componente (Fz, Fy, Fx) com MPU-6050 e Raspberry Pi

Este guia explica, passo a passo, como o estudante deve configurar e rodar o sistema de monitoramento de forças biomecânicas (vGRF) em tempo real, utilizando um sensor **IMU MPU-6050** conectado a um **Raspberry Pi** via Wi-Fi (WebSockets), transmitindo a uma taxa de **100 Hz**.

---

## 📐 Como o Sistema Funciona
1. **Aquisição:** O Raspberry Pi lê os dados brutos de aceleração linear (em $g$) e velocidade angular (em $\circ/s$) do sensor MPU-6050.
2. **Transmissão:** O Raspberry Pi atua como um servidor WebSocket (`ws://0.0.0.0:8765`), transmitindo os dados em tempo real a 100 Hz.
3. **Filttragem e Processamento (no Painel Web):**
   - **Filtro Butterworth Causal de 4ª Ordem (LPF a 10 Hz):** Remove ruídos de alta frequência do sinal de aceleração e giroscópio.
   - **Filtro Complementar ($\alpha = 0.98$):** Estima a inclinação angular (Pitch/Roll) em tempo real para remover o vetor de gravidade ($1g$) da aceleração.
   - **Estimativa de Força ($F = m \cdot a$):** Utiliza o peso do paciente inserido no painel para projetar as componentes de força $Fx$ (Médio-Lateral), $Fy$ (Antero-Posterior) e $Fz$ (Vertical) em Newtons ($N$).

---

## 🛠️ Cenário A: Simulação Local (Sem Hardware)
*Excelente para testar o painel e os algoritmos de processamento de sinal sem precisar montar a parte física.*

1. **Abra o terminal** no seu computador principal (onde clonou o projeto).
2. **Instale a biblioteca de WebSockets** no Python do seu computador:
   ```bash
   pip install websockets
   ```
3. **Execute o simulador do sensor** (que gera dados de marcha humana realísticos com ruído típico do MPU-6050):
   ```bash
   python sensor_streamer.py
   ```
   *O simulador iniciará um servidor local em `ws://localhost:8765`.*
4. **Inicie o servidor Web** para carregar o painel no navegador:
   ```bash
   python -m http.server 8000
   ```
5. **Abra o navegador** e acesse:
   [http://localhost:8000](http://localhost:8000)
6. No painel (barra lateral esquerda):
   - Altere a **Data Source** para `Raspberry Pi (WiFi)`.
   - Clique em **"Connect to Raspberry Pi"**.
   - Os gráficos dinâmicos de $Fz$, $Fy$ e $Fx$ começarão a desenhar em tempo real a 100 Hz!

---

## 🔌 Cenário B: Conexão Real com Raspberry Pi e MPU-6050
*Siga estes passos para implantar o sistema no hardware físico.*

### Passo 1: Conexão Física (I2C) do MPU-6050 no Raspberry Pi
Desligue o Raspberry Pi e faça as conexões nos pinos GPIO utilizando cabos jumper femea-femea:

| MPU-6050 | Função | Pino Físico do Raspberry Pi (GPIO) |
| :--- | :--- | :--- |
| **VCC** | Alimentação | **Pino 1** (3.3V Power) |
| **GND** | Terra | **Pino 6** (Ground) |
| **SDA** | Dados I2C | **Pino 3** (SDA / GPIO 2) |
| **SCL** | Clock I2C | **Pino 5** (SCL / GPIO 3) |

---

### Passo 2: Habilitar o I2C no Raspberry Pi
1. No terminal do Raspberry Pi, abra a ferramenta de configuração:
   ```bash
   sudo raspi-config
   ```
2. Vá em **Interfacing Options** (ou *Interface Options*).
3. Selecione **I2C** e escolha **Yes** para habilitar.
4. Reinicie o Raspberry Pi se solicitado:
   ```bash
   sudo reboot
   ```
5. *(Opcional)* Verifique se o sensor foi detectado no endereço I2C padrão (`0x68`):
   ```bash
   sudo apt-get install -y i2c-tools
   i2cdetect -y 1
   ```
   *Você deverá ver o número `68` na tabela impressa no terminal.*

---

### Passo 3: Preparar o Script do Estudante no Raspberry Pi
1. Crie uma pasta para o projeto no Raspberry Pi e instale as dependências necessárias:
   ```bash
   pip install mpu6050-raspberrypi websockets
   ```
2. Crie um arquivo chamado `rpi_streamer.py` e cole o código abaixo (este script lê o sensor fisicamente e envia via WebSocket):

```python
import asyncio
import json
import time
import websockets
from mpu6050 import mpu6050

SAMPLE_RATE = 100          # Taxa de amostragem de 100 Hz
HOST        = '0.0.0.0'    # Escuta em todas as interfaces de rede
PORT        = 8765         # Porta de comunicação WebSocket

# Inicializa o sensor no endereço I2C padrão (0x68)
sensor = mpu6050(0x68)

# Configura a escala do Acelerômetro para ±2g
sensor.set_accel_range(mpu6050.ACCEL_RANGE_2G)

# Configura a escala do Giroscópio para ±250 deg/sec
sensor.set_gyro_range(mpu6050.GYRO_RANGE_250DEG)

async def stream(ws):
    print(f"[+] Cliente conectado: {ws.remote_address}")
    dt = 1.0 / SAMPLE_RATE
    G = 9.80665 # Gravidade padrão
    
    try:
        while True:
            t0 = time.monotonic()
            
            # Leitura dos dados físicos brutos convertidos
            acc  = sensor.get_accel_data()   # Retorna {'x', 'y', 'z'} em m/s²
            gyro = sensor.get_gyro_data()    # Retorna {'x', 'y', 'z'} em deg/s
            
            payload = {
                "ax":  round(acc['x'] / G, 5),   # Converte m/s² -> g
                "ay":  round(acc['y'] / G, 5),   # Converte m/s² -> g
                "az":  round(acc['z'] / G, 5),   # Converte m/s² -> g
                "gx":  round(gyro['x'], 3),      # Já em deg/s
                "gy":  round(gyro['y'], 3),      # Já em deg/s
                "gz":  round(gyro['z'], 3),      # Já em deg/s
                "t":   round(time.time(), 4)     # Timestamp UTC
            }
            
            # Transmite via WebSocket
            await ws.send(json.dumps(payload))
            
            # Compensação precisa de tempo para manter a taxa de 100 Hz
            elapsed = time.monotonic() - t0
            await asyncio.sleep(max(0, dt - elapsed))
            
    except websockets.exceptions.ConnectionClosed:
        print(f"[-] Cliente desconectado: {ws.remote_address}")

async def main():
    async with websockets.serve(stream, HOST, PORT):
        print(f"📡 Transmissor MPU-6050 rodando em ws://<IP-do-RPi>:{PORT} @ {SAMPLE_RATE} Hz")
        await asyncio.Future()

if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nTransmissão encerrada.")
```

3. **Rode o script de transmissão no Raspberry Pi:**
   ```bash
   python rpi_streamer.py
   ```

---

### Passo 4: Executar o Painel Web (Dashboard) no Raspberry Pi
Para que a conexão WebSockets funcione sem problemas de segurança entre dispositivos, sirva a pasta do painel diretamente do Raspberry Pi:

1. Transfira a pasta inteira do painel (`vgrf-dashboard`) para o seu Raspberry Pi.
2. Navegue até a pasta no terminal do RPi:
   ```bash
   cd vgrf-dashboard
   ```
3. Inicie o servidor HTTP na porta 8000:
   ```bash
   python -m http.server 8000
   ```

---

### Passo 5: Acessar o Dashboard no seu PC/Notebook
1. Descubra o endereço de IP do seu Raspberry Pi na rede local rodando no RPi:
   ```bash
   hostname -I
   ```
   *Exemplo de saída: `192.168.1.15`*
2. No seu computador principal (que deve estar na **mesma rede Wi-Fi** que o Raspberry Pi), abra o navegador de sua preferência (Chrome/Edge recomendados).
3. Digite o endereço do servidor HTTP do RPi:
   ```
   http://<IP-do-seu-Raspberry-Pi>:8000
   ```
   *Exemplo: `http://192.168.1.15:8000`*
4. O painel web carregará perfeitamente. Como você o acessou usando o IP do RPi, o código JavaScript identificará o host automaticamente!

---

### Passo 6: Conectar e Monitorar
1. **Preencha os Dados do Paciente:**
   - **ID**, **Idade**, **Sexo**, e **Condição**.
   - **Importante:** Insira o **Peso Corporal (kg)** correto. O algoritmo calcula a força em Newtons escalando a aceleração pela massa ($F = m \cdot a$), portanto, um peso correto é essencial para a precisão física dos gráficos.
   - Escolha o **Status** da atividade (ex: *Active Walking*, *Trotting*, etc.).
2. **Estabeleça a Conexão:**
   - Na barra lateral esquerda, em **Data Source**, certifique-se de que está selecionado `Raspberry Pi (WiFi)`.
   - Clique no botão azul **"Connect to Raspberry Pi"**.
   - O status mudará de "Disconnected" para **"Live · <IP-do-RPi>:8765"**.
3. **Visualize:**
   - O painel exibirá as 3 componentes de forças em tempo real:
     - **Fz (Vertical):** O gráfico em esmeralda, que mostra as fases clássicas de toque de calcanhar e impulsão de ponta do pé da marcha.
     - **Fy (Antero-Posterior):** O gráfico em azul, que mostra a desaceleração (fase de frenagem) e a aceleração (fase de propulsão).
     - **Fx (Médio-Lateral):** O gráfico em amarelo, que mostra as oscilações de equilíbrio laterais.
   - Alterne entre as abas na barra lateral para analisar as métricas dinâmicas de cada componente separadamente.

---

## 🔍 Resolução de Problemas (Troubleshooting)

### 1. O botão fica em "Connecting..." e depois volta para "Disconnected"
- **Rede Wi-Fi:** Certifique-se de que o computador e o Raspberry Pi estão conectados exatamente no mesmo roteador/rede local. Redes corporativas ou públicas de universidades podem possuir bloqueios de portas ("Client Isolation").
- **Firewall:** Verifique se o firewall do Raspberry Pi ou do computador não está bloqueando conexões de entrada na porta `8765`.
- **IP Incorreto:** Garanta que você está acessando o painel web através de `http://<IP-do-Raspberry-Pi>:8000` e **não** abrindo o arquivo `index.html` diretamente no navegador (dois cliques no arquivo). Abrir o arquivo localmente faz com que o dashboard tente conectar a `localhost:8765` em vez de conectar ao Raspberry Pi.

### 2. A taxa de transmissão está lenta ou instável
- O barramento I2C do Raspberry Pi por padrão roda a 100 kHz. Para taxas de amostragem de 100 Hz com dois sensores ou leituras mais rápidas, mude o clock do barramento I2C para **400 kHz** (Fast Mode):
  - Abra o arquivo `/boot/config.txt` no Raspberry Pi (`sudo nano /boot/config.txt`).
  - Adicione ou altere a linha: `dtparam=i2c_arm_baudrate=400000`
  - Salve o arquivo (Ctrl+O, Enter) e saia (Ctrl+X).
  - Reinicie o RPi (`sudo reboot`).
