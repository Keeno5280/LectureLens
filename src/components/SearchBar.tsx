import { useState, useEffect, useRef } from 'react';
import { Search, X, Loader2, BookOpen, Filter } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Lecture, Class } from '../lib/supabase';
import { useNavigate } from '../hooks/useNavigate';

type SearchResult = Lecture & {
  class_name?: string;
};

export default function SearchBar() {
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [selectedClass, setSelectedClass] = useState<string>('all');
  const [showFilters, setShowFilters] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<NodeJS.Timeout>();
  const navigate = useNavigate();

  useEffect(() => {
    loadClasses();
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowResults(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (searchQuery.length >= 2) {
      debounceRef.current = setTimeout(() => {
        performSearch(searchQuery);
      }, 300);
    } else {
      setResults([]);
      setShowResults(false);
    }

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [searchQuery, selectedClass]);

  const loadClasses = async () => {
    try {
      const { data } = await supabase
        .from('classes')
        .select('*')
        .order('name');

      if (data) setClasses(data);
    } catch (error) {
      console.error('Error loading classes:', error);
    }
  };

  const performSearch = async (query: string) => {
    setIsSearching(true);
    try {
      let lectureQuery = supabase
        .from('lectures')
        .select('*, classes(name)')
        .or(`title.ilike.%${query}%,summary_overview.ilike.%${query}%`)
        .order('recording_date', { ascending: false })
        .limit(10);

      if (selectedClass !== 'all') {
        lectureQuery = lectureQuery.eq('class_id', selectedClass);
      }

      const { data, error } = await lectureQuery;

      if (error) throw error;

      const mappedResults = (data || []).map((lecture: any) => ({
        ...lecture,
        class_name: lecture.classes?.name || 'Unknown Class',
      }));

      setResults(mappedResults);
      setShowResults(true);
    } catch (error) {
      console.error('Error searching:', error);
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim().length >= 2) {
      performSearch(searchQuery);
    }
  };

  const handleClear = () => {
    setSearchQuery('');
    setResults([]);
    setShowResults(false);
  };

  const handleResultClick = (lectureId: string) => {
    navigate('lecture', lectureId);
    setShowResults(false);
    setSearchQuery('');
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const highlightMatch = (text: string, query: string) => {
    if (!query.trim() || !text) return text;

    const parts = text.split(new RegExp(`(${query})`, 'gi'));
    return parts.map((part, index) =>
      part.toLowerCase() === query.toLowerCase()
        ? `<mark class="bg-yellow-200 text-gray-900">${part}</mark>`
        : part
    ).join('');
  };

  return (
    <div ref={searchRef} className="w-full max-w-3xl mx-auto relative">
      <form onSubmit={handleSearchSubmit} className="relative">
        <div className="relative flex items-center gap-2">
          <div className="relative flex-1">
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
              <Search className="w-5 h-5 text-gray-400" aria-hidden="true" />
            </div>

            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search notes..."
              aria-label="Search lecture notes"
              className="w-full h-12 pl-12 pr-12 py-3 bg-white border-2 border-gray-200 rounded-xl
                       text-gray-900 placeholder-gray-400
                       focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100
                       transition-all duration-200
                       sm:text-base text-sm"
            />

            {searchQuery && (
              <button
                type="button"
                onClick={handleClear}
                className="absolute inset-y-0 right-0 pr-4 flex items-center text-gray-400 hover:text-gray-600 transition"
                aria-label="Clear search"
              >
                <X className="w-5 h-5" />
              </button>
            )}

            {isSearching && (
              <div className="absolute inset-y-0 right-12 flex items-center">
                <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setShowFilters(!showFilters)}
            className={`h-12 px-4 rounded-xl border-2 transition-all duration-200 flex items-center gap-2
                      ${showFilters
                        ? 'bg-blue-50 border-blue-500 text-blue-700'
                        : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'}`}
            aria-label="Toggle filters"
            aria-expanded={showFilters}
          >
            <Filter className="w-5 h-5" />
            <span className="hidden sm:inline text-sm font-medium">Filter</span>
          </button>

          <button
            type="submit"
            disabled={searchQuery.length < 2}
            className="h-12 px-6 bg-blue-600 text-white rounded-xl font-medium
                     hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
                     disabled:bg-gray-300 disabled:cursor-not-allowed
                     transition-all duration-200
                     hidden sm:flex items-center gap-2"
            aria-label="Search"
          >
            <Search className="w-5 h-5" />
            Search
          </button>
        </div>

        {showFilters && (
          <div className="mt-3 p-4 bg-white border-2 border-gray-200 rounded-xl shadow-sm animate-in slide-in-from-top-2">
            <label htmlFor="class-filter" className="block text-sm font-medium text-gray-700 mb-2">
              Filter by Class
            </label>
            <select
              id="class-filter"
              value={selectedClass}
              onChange={(e) => setSelectedClass(e.target.value)}
              className="w-full h-10 px-3 bg-white border-2 border-gray-200 rounded-lg
                       text-gray-900 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100
                       transition-all duration-200"
              aria-label="Filter lectures by class"
            >
              <option value="all">All Classes</option>
              {classes.map((cls) => (
                <option key={cls.id} value={cls.id}>
                  {cls.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </form>

      {showResults && (
        <div
          className="absolute z-50 w-full mt-2 bg-white border-2 border-gray-200 rounded-xl shadow-xl max-h-96 overflow-y-auto"
          role="listbox"
          aria-label="Search results"
        >
          {results.length === 0 ? (
            <div className="p-8 text-center">
              <BookOpen className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-600 font-medium">No results found</p>
              <p className="text-gray-400 text-sm mt-1">
                Try adjusting your search terms or filters
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {results.map((result) => (
                <li key={result.id}>
                  <button
                    onClick={() => handleResultClick(result.id)}
                    className="w-full px-4 py-4 text-left hover:bg-gray-50 transition-colors duration-150
                             focus:outline-none focus:bg-blue-50 focus:ring-2 focus:ring-inset focus:ring-blue-500"
                    role="option"
                    aria-selected="false"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <h3
                          className="text-base font-semibold text-gray-900 mb-1 truncate"
                          dangerouslySetInnerHTML={{
                            __html: highlightMatch(result.title, searchQuery)
                          }}
                        />

                        {result.summary_overview && (
                          <p
                            className="text-sm text-gray-600 line-clamp-2 mb-2"
                            dangerouslySetInnerHTML={{
                              __html: highlightMatch(
                                result.summary_overview.substring(0, 150) + '...',
                                searchQuery
                              )
                            }}
                          />
                        )}

                        <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
                          <span className="flex items-center gap-1">
                            <BookOpen className="w-3.5 h-3.5" />
                            {result.class_name}
                          </span>
                          <span>•</span>
                          <span>{formatDate(result.recording_date)}</span>
                        </div>
                      </div>

                      <span
                        className={`flex-shrink-0 px-2.5 py-1 rounded-full text-xs font-medium ${
                          result.processing_status === 'completed'
                            ? 'bg-green-100 text-green-700'
                            : result.processing_status === 'processing'
                            ? 'bg-blue-100 text-blue-700'
                            : result.processing_status === 'failed'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-yellow-100 text-yellow-700'
                        }`}
                      >
                        {result.processing_status}
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
