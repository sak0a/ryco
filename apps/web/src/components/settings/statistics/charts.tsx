import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";

import {
  chartColor,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "~/components/ui/chart";
import {
  formatDayLabel,
  formatInteger,
  formatProviderLabel,
  formatTokens,
} from "~/lib/statisticsFormat";

import type { DayPoint, ProjectAggregate, ProviderAggregate } from "./selectors";

function truncateLabel(value: string, max = 14): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function TokensOverTimeChart({ data }: { data: ReadonlyArray<DayPoint> }) {
  return (
    <ChartContainer className="h-[240px]">
      <AreaChart data={[...data]} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="statFillInput" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={chartColor(0)} stopOpacity={0.4} />
            <stop offset="95%" stopColor={chartColor(0)} stopOpacity={0.04} />
          </linearGradient>
          <linearGradient id="statFillOutput" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={chartColor(1)} stopOpacity={0.4} />
            <stop offset="95%" stopColor={chartColor(1)} stopOpacity={0.04} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={28}
          tickFormatter={(value) => formatDayLabel(String(value))}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={38}
          tickFormatter={(value) => formatTokens(Number(value) || 0)}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(label) => formatDayLabel(String(label))}
              formatter={(value) => formatTokens(Number(value) || 0)}
            />
          }
        />
        <Area
          dataKey="inputTokens"
          name="Input"
          type="monotone"
          stackId="tokens"
          stroke={chartColor(0)}
          fill="url(#statFillInput)"
          strokeWidth={1.5}
        />
        <Area
          dataKey="outputTokens"
          name="Output"
          type="monotone"
          stackId="tokens"
          stroke={chartColor(1)}
          fill="url(#statFillOutput)"
          strokeWidth={1.5}
        />
      </AreaChart>
    </ChartContainer>
  );
}

export function ProviderDonut({ data }: { data: ReadonlyArray<ProviderAggregate> }) {
  const chartData = data.map((entry, index) => ({
    name: formatProviderLabel(entry.provider),
    value: entry.totalTokens,
    fill: chartColor(index),
  }));
  const total = chartData.reduce((acc, entry) => acc + entry.value, 0);

  if (total === 0) {
    return (
      <div className="py-10 text-center text-muted-foreground text-xs">No token usage yet.</div>
    );
  }

  return (
    <div className="flex items-center gap-4">
      <ChartContainer className="h-[200px] w-[200px] shrink-0">
        <PieChart>
          <ChartTooltip
            content={
              <ChartTooltipContent
                hideLabel
                formatter={(value) => formatTokens(Number(value) || 0)}
              />
            }
          />
          <Pie
            data={chartData}
            dataKey="value"
            nameKey="name"
            innerRadius={56}
            outerRadius={84}
            paddingAngle={2}
            strokeWidth={2}
          >
            {chartData.map((entry) => (
              <Cell key={entry.name} fill={entry.fill} stroke="var(--card)" />
            ))}
          </Pie>
        </PieChart>
      </ChartContainer>
      <ul className="flex min-w-0 flex-1 flex-col gap-2">
        {chartData.map((entry) => {
          const share = Math.round((entry.value / total) * 100);
          return (
            <li key={entry.name} className="flex items-center gap-2 text-xs">
              <span
                className="size-2.5 shrink-0 rounded-[3px]"
                style={{ backgroundColor: entry.fill }}
              />
              <span className="min-w-0 flex-1 truncate text-foreground">{entry.name}</span>
              <span className="text-muted-foreground tabular-nums">{share}%</span>
              <span className="w-12 text-right font-medium text-foreground tabular-nums">
                {formatTokens(entry.value)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function ProjectBars({ data }: { data: ReadonlyArray<ProjectAggregate> }) {
  const chartData = data.slice(0, 6).map((entry, index) => ({
    name: entry.title,
    value: entry.totalTokens,
    fill: chartColor(index),
  }));

  if (chartData.length === 0) {
    return (
      <div className="py-10 text-center text-muted-foreground text-xs">No project usage yet.</div>
    );
  }

  return (
    <ChartContainer className="h-[220px]">
      <BarChart
        data={chartData}
        layout="vertical"
        margin={{ left: 4, right: 16, top: 4, bottom: 4 }}
      >
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="name"
          width={96}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value) => truncateLabel(String(value))}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              hideLabel
              formatter={(value) => formatTokens(Number(value) || 0)}
            />
          }
        />
        <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={26}>
          {chartData.map((entry) => (
            <Cell key={entry.name} fill={entry.fill} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

export function CodeChangesChart({ data }: { data: ReadonlyArray<DayPoint> }) {
  const chartData = data.map((point) => ({
    date: point.date,
    additions: point.additions,
    deletionsSigned: -point.deletions,
  }));
  return (
    <ChartContainer className="h-[200px]">
      <BarChart
        data={chartData}
        margin={{ left: 4, right: 8, top: 8, bottom: 0 }}
        stackOffset="sign"
      >
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={28}
          tickFormatter={(value) => formatDayLabel(String(value))}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={38}
          tickFormatter={(value) => formatTokens(Math.abs(Number(value) || 0))}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(label) => formatDayLabel(String(label))}
              formatter={(value) => formatInteger(Math.abs(Number(value) || 0))}
            />
          }
        />
        <Bar
          dataKey="additions"
          name="Added"
          fill="var(--success)"
          radius={[2, 2, 0, 0]}
          maxBarSize={18}
        />
        <Bar
          dataKey="deletionsSigned"
          name="Removed"
          fill="var(--destructive)"
          radius={[0, 0, 2, 2]}
          maxBarSize={18}
        />
      </BarChart>
    </ChartContainer>
  );
}
