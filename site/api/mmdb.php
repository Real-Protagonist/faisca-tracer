<?php
/**
 * Leitor mínimo de bases MaxMind DB (.mmdb), em PHP puro, só para consultas por IP.
 * Formato: https://maxmind.github.io/MaxMind-DB/ (árvore binária de pesquisa + secção de dados).
 * Usado com a base gratuita DB-IP City Lite (CC BY 4.0).
 */

if (basename($_SERVER['SCRIPT_FILENAME'] ?? '') === basename(__FILE__)) {
    http_response_code(404);
    exit;
}

final class Mmdb
{
    private const META_MARKER = "\xAB\xCD\xEFMaxMind.com";

    /** @var resource */
    private $fh;
    /** @var array */
    public $metadata;
    private $nodeCount;
    private $recordSize;
    private $nodeBytes;
    private $treeSize;
    private $dataStart;
    private $ipv4Start = null;

    public function __construct(string $file)
    {
        $fh = @fopen($file, 'rb');
        if (!$fh) {
            throw new RuntimeException("Não foi possível abrir $file");
        }
        $this->fh = $fh;
        $size = filesize($file);
        $tail = min($size, 128 * 1024);
        fseek($fh, $size - $tail);
        $buf = fread($fh, $tail);
        $pos = strrpos($buf, self::META_MARKER);
        if ($pos === false) {
            throw new RuntimeException('Ficheiro .mmdb inválido (sem metadados)');
        }
        $metaStart = $size - $tail + $pos + strlen(self::META_MARKER);
        $this->metadata = $this->decode($metaStart, $metaStart)[0];
        $this->nodeCount = (int) $this->metadata['node_count'];
        $this->recordSize = (int) $this->metadata['record_size'];
        if (!in_array($this->recordSize, [24, 28, 32], true)) {
            throw new RuntimeException('Tamanho de registo não suportado: ' . $this->recordSize);
        }
        $this->nodeBytes = $this->recordSize / 4;
        $this->treeSize = $this->nodeCount * $this->nodeBytes;
        $this->dataStart = $this->treeSize + 16;
    }

    public function __destruct()
    {
        if (is_resource($this->fh)) {
            fclose($this->fh);
        }
    }

    /** Registo da base para o IP, ou null se não houver. */
    public function get(string $ip)
    {
        $packed = @inet_pton($ip);
        if ($packed === false) {
            return null;
        }
        $bitCount = strlen($packed) * 8;
        $node = 0;
        if ($bitCount === 32 && (int) $this->metadata['ip_version'] === 6) {
            $node = $this->ipv4StartNode();
        } elseif ($bitCount === 128 && (int) $this->metadata['ip_version'] === 4) {
            return null;
        }
        for ($i = 0; $i < $bitCount && $node < $this->nodeCount; $i++) {
            $bit = (ord($packed[$i >> 3]) >> (7 - ($i & 7))) & 1;
            $node = $this->readRecord($node, $bit);
        }
        if ($node === $this->nodeCount) {
            return null; // sem dados
        }
        if ($node < $this->nodeCount) {
            throw new RuntimeException('Árvore inválida');
        }
        $offset = $node - $this->nodeCount + $this->treeSize; // posição no ficheiro
        return $this->decode($offset, $this->dataStart)[0];
    }

    private function ipv4StartNode(): int
    {
        if ($this->ipv4Start === null) {
            $node = 0;
            for ($i = 0; $i < 96 && $node < $this->nodeCount; $i++) {
                $node = $this->readRecord($node, 0);
            }
            $this->ipv4Start = $node;
        }
        return $this->ipv4Start;
    }

    private function read(int $offset, int $length): string
    {
        if ($length === 0) {
            return '';
        }
        fseek($this->fh, $offset);
        $s = fread($this->fh, $length);
        if ($s === false || strlen($s) !== $length) {
            throw new RuntimeException('Leitura fora do ficheiro');
        }
        return $s;
    }

    private function readRecord(int $node, int $bit): int
    {
        $b = $this->read($node * $this->nodeBytes, $this->nodeBytes);
        switch ($this->recordSize) {
            case 24:
                $r = substr($b, $bit * 3, 3);
                return (ord($r[0]) << 16) | (ord($r[1]) << 8) | ord($r[2]);
            case 28:
                if ($bit === 0) {
                    return ((ord($b[3]) & 0xF0) << 20) | (ord($b[0]) << 16) | (ord($b[1]) << 8) | ord($b[2]);
                }
                return ((ord($b[3]) & 0x0F) << 24) | (ord($b[4]) << 16) | (ord($b[5]) << 8) | ord($b[6]);
            default:
                return unpack('N', substr($b, $bit * 4, 4))[1];
        }
    }

    private static function uint(string $bytes): int
    {
        $n = 0;
        $len = strlen($bytes);
        for ($i = 0; $i < $len; $i++) {
            $n = ($n << 8) | ord($bytes[$i]);
        }
        return $n;
    }

    /**
     * Descodifica o valor em $offset. $base é o início da secção de dados (os ponteiros contam a partir dali).
     * Devolve [valor, offset seguinte].
     */
    private function decode(int $offset, int $base): array
    {
        $ctrl = ord($this->read($offset, 1));
        $offset++;
        $type = $ctrl >> 5;

        if ($type === 1) { // ponteiro
            $ss = ($ctrl >> 3) & 0x3;
            $vvv = $ctrl & 0x7;
            $b = $this->read($offset, $ss + 1);
            $offset += $ss + 1;
            switch ($ss) {
                case 0:
                    $p = ($vvv << 8) | ord($b[0]);
                    break;
                case 1:
                    $p = (($vvv << 16) | self::uint($b)) + 2048;
                    break;
                case 2:
                    $p = (($vvv << 24) | self::uint($b)) + 526336;
                    break;
                default:
                    $p = self::uint($b);
            }
            $value = $this->decode($base + $p, $base)[0];
            return [$value, $offset];
        }

        if ($type === 0) { // tipo estendido
            $type = 7 + ord($this->read($offset, 1));
            $offset++;
        }

        $size = $ctrl & 0x1F;
        if ($size >= 29) {
            $extra = $size - 28;
            $n = self::uint($this->read($offset, $extra));
            $offset += $extra;
            $size = $size === 29 ? 29 + $n : ($size === 30 ? 285 + $n : 65821 + $n);
        }

        switch ($type) {
            case 2: // texto UTF-8
            case 4: // bytes
                return [$this->read($offset, $size), $offset + $size];
            case 3: // double
                $v = unpack('E', $this->read($offset, 8))[1];
                return [$v, $offset + 8];
            case 15: // float
                $v = unpack('G', $this->read($offset, 4))[1];
                return [$v, $offset + 4];
            case 5: // uint16
            case 6: // uint32
            case 9: // uint64
            case 10: // uint128 (os valores grandes não interessam aqui)
                return [self::uint($this->read($offset, $size)), $offset + $size];
            case 8: // int32
                $n = self::uint($this->read($offset, $size));
                if ($size === 4 && $n >= 0x80000000) {
                    $n -= 0x100000000;
                }
                return [$n, $offset + $size];
            case 7: // mapa
                $map = [];
                for ($i = 0; $i < $size; $i++) {
                    [$k, $offset] = $this->decode($offset, $base);
                    [$v, $offset] = $this->decode($offset, $base);
                    $map[$k] = $v;
                }
                return [$map, $offset];
            case 11: // lista
                $list = [];
                for ($i = 0; $i < $size; $i++) {
                    [$v, $offset] = $this->decode($offset, $base);
                    $list[] = $v;
                }
                return [$list, $offset];
            case 14: // booleano
                return [$size !== 0, $offset];
            default:
                throw new RuntimeException("Tipo de dados desconhecido: $type");
        }
    }
}
