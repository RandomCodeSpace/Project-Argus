import type { Trace } from '../types';

interface TracesResponse {
    traces: Trace[];
    total: number;
    limit: number;
    offset: number;
}

export const fetchTraces = async (
    start?: string,
    end?: string,
    services?: string[],
    status?: string,
    search?: string,
    limit = 20,
    offset = 0,
    sortBy?: string,
    orderBy?: 'asc' | 'desc'
): Promise<TracesResponse> => {
    const params = new URLSearchParams();

    if (start) params.append('start', start);
    if (end) params.append('end', end);
    if (services && services.length > 0) {
        services.forEach(s => params.append('service_name', s));
    }
    if (status) params.append('status', status);
    if (search) params.append('search', search);
    if (sortBy) params.append('sort_by', sortBy);
    if (orderBy) params.append('order_by', orderBy);
    params.append('limit', limit.toString());
    params.append('offset', offset.toString());

    const response = await fetch(`/api/traces?${params.toString()}`);
    if (!response.ok) {
        throw new Error(`Failed to fetch traces: ${response.statusText}`);
    }
    return response.json();
};
